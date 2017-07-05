'use strict';
/* global AFRAME, Promise, Uint32Array, Map, Set, THREE */
/* eslint no-var: 0 */

var localObjectTracker = [];
var connectedUsersIds = new Set();
var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
var halfMaxUint32 = Math.pow(2,31);
var radToDeg = 180/Math.PI;

function floatToUint32(n) {
  return (n * 1000) + halfMaxUint32;
}

function uint32ToFloat(n) {
  return (n - halfMaxUint32) / 1000;
}

// Connection opened
function getNewWS(url, callbacks) {
	return new Promise(function (resolve, reject) {

		var interval = -1;
		var ws;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			return reject(e);
		}
		ws.binaryType = 'arraybuffer';

		ws.isAlive = true;

		ws.addEventListener('message', function m(e) {
			if (typeof e.data === 'string') {
				if (e.data === '__pong__') {
					ws.isAlive = true;
					return;
				}
				var data = JSON.parse(e.data);
				if (ws.id === undefined && data[0] === 'HANDSHAKE') {
					ws.id = data[1];
					return resolve(ws);
				}
				if (data[0] === 'UPDATE_USERS') {
					var newUsers = new Set(data[1]);
					newUsers.delete(ws.id);
					newUsers.forEach(function (id) {
						if (!connectedUsersIds.has(id)) {
							connectedUsersIds.add(id);
							callbacks.userJoinCallback(ws, id);
						}
					});
					Array.from(connectedUsersIds)
					.filter(function (id) {
						if (!newUsers.has(id)) {
							callbacks.userLeaveCallback(id);
							connectedUsersIds.delete(ws, id);
						}
					});
					return;
				}
				if (data[0] === 'UPDATE_REMOTE_EL') {
					if (data[1] === ws.id) return;
					callbacks.createForeignEl(ws, data[1], data[2]);
					return;
				}
				if (data[0] === 'REMOVE_REMOTE_EL') {
					if (data[1] === ws.id) return;
					callbacks.removeForeignEl(ws, data[1], data[2]);
					return;
				}
				if (data[0] === 'STEAL_EL') {
					callbacks.stealEl(ws, data[1], data[2]);
					return;
				}
			} else {
				var temp = new Uint32Array(e.data);
				callbacks.messageCallback(ws, temp);
			}
		});

		ws.addEventListener('close', terminate);

		ws.addEventListener('open', function firstOpen() {

			/* eslint-disable no-console */
			console.log('Connected to the server...');

			interval = setInterval(function ping() {
				if (ws.isAlive === false) {
					console.log('Timeout...');
					terminate();
				}
				ws.isAlive = false;
				ws.send('__ping__');
			}, 3000);

			ws.removeEventListener('open', firstOpen);
			/* eslint-enable no-console */
		});

		function terminate() {
			ws.close();
			clearInterval(interval);
		}
	});
}

AFRAME.registerSystem('fast-sync-controller', {
	schema: {
		room: {
			default: 'demo'
		},
		url: {
			default: (isLocal ? 'ws://' : 'wss://') + location.host
		}
	},
	init: function () {
		this.objects = new Map();
		this.foreignObjects = new Map();
		this._wsPromise = getNewWS(this.data.url, {
			messageCallback: this.onbinary.bind(this),
			createForeignEl: this.onupdate.bind(this),
			removeForeignEl: this.onremove.bind(this),
			userJoinCallback: this.onuserjoin.bind(this),
			stealEl: this.onstealel.bind(this),
			userLeaveCallback: function (id) {
				/* eslint-disable no-console */
				console.log(id);
				/* eslint-enable no-console */
			}
		});
		this.getWs(function (ws) {
			ws.send(JSON.stringify(['HANDSHAKE', this.data.room]));
			this._ws = ws;
		}.bind(this));
		this.tick = AFRAME.utils.throttleTick(this.throttledTick, 1000/30, this);
	},
	throttledTick: function () {
		if (!this._ws) return;
		var toSerial = Array.from(this.objects.values())
		.filter(function (el) {
			return el.components['fast-sync'].syncId !== undefined;
		});
		var count = toSerial.length;
		if (!count) return;
		var bindata = new Uint32Array(2 + 7 * count);
		var index = 2;
		bindata[0] = this._ws.id;
		bindata[1] = count;

		toSerial.forEach(function (el) {
			var data = el.components['fast-sync'].getSyncData();
			var pos = data.position;
			var rot = data.rotation;
			bindata[0 + index] = el.components['fast-sync'].syncId;
			bindata[1 + index] = floatToUint32(rot.x);
			bindata[2 + index] = floatToUint32(rot.y);
			bindata[3 + index] = floatToUint32(rot.z);
			bindata[4 + index] = floatToUint32(pos.x);
			bindata[5 + index] = floatToUint32(pos.y);
			bindata[6 + index] = floatToUint32(pos.z);
			index += 7;
		});

		this._ws.send(bindata);
	},
	onuserjoin: function (ws, id) {
		/* eslint-disable */
		console.log('User joined: ' + ws.id, id, location.pathname);
		/*eslint-enable */
		// Update newly joined user
		Array.from(this.objects.values())
		.forEach(function (el) {
			if (ws.id !== id) el.components['fast-sync'].getSyncTemplate(ws.id).then(function(template) {
				ws.send(JSON.stringify(['UPDATE_REMOTE_EL', id, template]));
			});
		});
	},
	onbinary: function (ws, message) {
		var index = 0;
		while (index < message.length) {
			var id = message[index];

			// Skip long sections of zeros
			if (id === 0) while (id === 0) id = message[++index];

			var count = message[index + 1];

			// skip self
			if (id === ws.id) {
				index += 2 + count * 7;
				continue;
			}

			// Somehow a string made it as binary
			if (count > 1024) {
				throw Error('Something probably went wrong');
			}

			// iterate over all the data
			while(count--) {
				var syncId = message[index + 2];
				if (this.foreignObjects.has(id + ',' + syncId)) {
					// sync rotation and position
					var el = this.foreignObjects.get(id + ',' + syncId);
					el.setAttribute('rotation', {
						x: uint32ToFloat(message[index + 3]),
						y: uint32ToFloat(message[index + 4]),
						z: uint32ToFloat(message[index + 5])
					});
					el.setAttribute('position', {
						x: uint32ToFloat(message[index + 6]),
						y: uint32ToFloat(message[index + 7]),
						z: uint32ToFloat(message[index + 8])
					});
				}
				index += 7;
			}
			index += 2;
		}
	},
	onupdate: function (ws, id, details) {
		if (id === ws.id) return;
		var fOId = id + ',' + details.syncId;
		var el;
		if (details.was) {
			var wasFOId = details.was.originalCreator + ',' + details.was.syncId;
			var el = this.foreignObjects.get(wasFOId);
			if (!el) throw Error('No element with that Id in Foreign Objects', wasFOId);
			this.foreignObjects.delete(wasFOId);
			this.foreignObjects.set(fOId, el);
		}
		if (details.html) {
			var oldEl = this.foreignObjects.get(fOId);
			if (oldEl) oldEl.parentNode.removeChild(oldEl);
			this.sceneEl.insertAdjacentHTML('beforeend', details.html);
			var el = this.sceneEl.lastElementChild;
			this.foreignObjects.set(fOId, el);
		}
		
		Element.prototype.setAttribute.call(el, 'fast-sync-listener', 'original-creator: ' + id + ' ; sync-id: ' + details.syncId + ';');			
		el._fastSyncConfig = details.config;
		el.transferables = details.transferables;
	},
	onremove: function (ws, id, details) {
		var el = this.foreignObjects.get(id + ',' + details.syncId);
		el.parentNode.remove(el);
	},
	onstealel: function (ws, id, o) {
		var details = o.idData;
		var options = o.options;
		var fOId = details.originalCreator + ',' + details.syncId;
		if (id === ws.id) {
			this.foreignObjects.get(fOId).components['fast-sync-listener']._stealComplete();
			this.foreignObjects.delete(fOId);
		} else {
			if (details.originalCreator === ws.id) {
				var el = this.objects.get(details.syncId);

				// My item has been stolen, give it up
				el.components['fast-sync'].teardown();
				el.removeAttribute('fast-sync');

				if (options.transfer) {
					options.transfer.forEach(function (attr) {
						el.removeAttribute(attr);
					});
				}

				// Assign it as a foreign object so it can be found updated later
				this.foreignObjects.set(fOId, el);

				el.emit('stolen');
			} else {
				// Someone's object has been stolen, transfer ownership from old user to new user
			}
		}
	},
	register: function (el) {
		var id;
		return this.getWs(function (ws) {
			var idIndex = localObjectTracker.includes(false) ? localObjectTracker.indexOf(false) : localObjectTracker.length;
			localObjectTracker[idIndex] = el;
			var actualId = 1024 * ws.id + idIndex;
			this.objects.set(actualId, el);
			id = actualId;
			return actualId;
		})
		.then(function () {
			return id;	
		});
	},
	updateEl: function (el) {
		this.getWs(function (ws) {
			el.components['fast-sync'].getSyncTemplate(ws.id).then(function (template) {
				ws.send(JSON.stringify(['UPDATE_REMOTE_EL', template]));
			});
		});
	},
	stealEl: function (data, options) {
		this.getWs(function (ws) {
			ws.send(JSON.stringify(['STEAL_EL', {
				idData: data,
				options: options
			}]));
		});
	},
	removeEl: function (syncId) {
		this.objects.delete(syncId);
		this.getWs(function (ws) {
			ws.send(JSON.stringify(['REMOVE_REMOTE_EL', {
				syncId: syncId
			}]));
		});
	},
	teardownEl: function (syncId) {
		this.objects.delete(syncId);
	},
	getWs: function getWs(callback) {
		this._wsPromise = this._wsPromise.then(function (ws) {
			var maybePromise = callback.bind(this)(ws);
			return maybePromise && maybePromise.constructor === Promise ? maybePromise.then(function () {
				return ws;
			}) : ws;
		}.bind(this));
		return this._wsPromise;
	}
});

AFRAME.registerComponent('fast-sync-listener', {
	schema: {
		originalCreator: {
			type: 'number'
		},
		syncId: {
			type: 'number'
		}
	},
	steal: function (options) {
		options = options || {};
		if (this.stealPromise) return this.stealPromise;
		this.el.sceneEl.systems['fast-sync-controller'].stealEl(this.data, options || {});
		this.stealPromise = new Promise(function (resolve) {
			this.stealResolve = resolve;
		}.bind(this))
		.then(function () {
			this.el.removeAttribute('fast-sync-listener');
			this.el.setAttribute('fast-sync', this.el._fastSyncConfig);
			this.el._fastSyncWas = this.data;
			if (options.transfer) options.transfer.forEach(function (attr) {
				this.el.setAttribute(attr, this.el.transferables[attr]);
			}.bind(this));
		}.bind(this));
		return this.stealPromise;
	},
	_stealComplete: function () {
		if (this.stealResolve) this.stealResolve();
	}
});

AFRAME.registerComponent('fast-sync', {
	schema: {

		// clone an element by selector on the remote
		clone: {
			default: ''
		},

		// Instead of copying self, copy another element
		copy: {
			type: 'selector'
		},

		components: {
			default: ''
		},

		transferables: {
			default: ''
		}
	},
	init: function () {
		this._registerPromise = this.el.sceneEl.systems['fast-sync-controller']
		.register(this.el)
		.then(function (syncId) {
			this.syncId = syncId;
			return syncId;
		}.bind(this));
	},
	update: function () {
		this.el.sceneEl.systems['fast-sync-controller'].updateEl(this.el);
	},
	getSyncData: (function () {
		var converter;
		return function () {
			var el = this.el;
			var pos = el.components.position.getData();
			var rot;
			if (el.components.quaternion) {
				var data = el.components.quaternion.getData();
				converter = converter || new THREE.Euler();
				converter.setFromQuaternion(data, 'YXZ');
				converter.x *= radToDeg;
				converter.y *= radToDeg;
				converter.z *= radToDeg;
				rot = converter;
			} else {
				rot = el.components.rotation.getData();
			}

			return {
				rotation: rot,
				position: pos
			}
		}
	}()),
	getSyncTemplate: function() {
		return this._registerPromise.then(function (syncId) {
			var config = this.data;
			var components = ['material', 'color', 'shadow', 'id', 'class']
			.concat(this.data.components.split(',').map(function (s) {
				return s.toLowerCase().trim();
			}));
			
			var transferables = {};
			if (this.data.transferables) this.data.transferables.split(',').forEach(function (s) {
				var attr = s.toLowerCase().trim();
				transferables[attr] = Element.prototype.getAttribute.call(this.el, attr);
			}.bind(this));

			if (this.el._fastSyncWas) {
				var was = this.el._fastSyncWas;
				delete this.el._fastSyncWas;
				return {
					was: was,
					syncId: syncId,
					config: this.data,
					transferables: transferables
				};
			}
	
			if (config.clone) {
				return {
					clone: config.clone,
					syncId: syncId,
					config: this.data,
					transferables: transferables
				};
			}
	
			var newEl;
	
			if (config.copy !== null) {
				newEl = config.copy.cloneNode();
			}
			if (config.copy === null) {
				newEl = this.el.cloneNode();
			}
	
			Array.from(newEl.attributes).forEach(function (a) {
				if (components.includes(a.name.toLowerCase())) return;
				newEl.removeAttribute(a.name);
			});
	
			return {
				html: newEl.outerHTML,
				syncId: syncId,
				config: this.data,
				transferables: transferables
			};
		}.bind(this));
	},
	remove: function () {
		if (this._tornDown === true) return;
		this._registerPromise.then(function (syncId) {
			this.el.sceneEl.systems['fast-sync-controller'].removeEl(syncId);
		}.bind(this));
	},
	teardown: function () {
		this._tornDown = true;
		this._registerPromise.then(function (syncId) {
			this.el.sceneEl.systems['fast-sync-controller'].teardownEl(syncId);
		}.bind(this));
	}
});