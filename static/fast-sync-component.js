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
					callbacks.createForeignEl(ws, data[1], data[2]);
					return;
				}
			} else {
				var temp = new Uint32Array(e.data);
				callbacks.messageCallback(ws, temp);
			}
		});

		ws.addEventListener('close', terminate);

		ws.addEventListener('open', function firstOpen() {

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
			userJoinCallback: function (ws, id) {

				console.log('User joined', ws.id + ':', id);
				// Update newly joined user
				Array.from(this.objects.values())
				.forEach(function (el) {
					el.components['fast-sync'].getSyncTemplate().then(function(template) {
						ws.send(JSON.stringify(['UPDATE_REMOTE_EL', id, template]));
					});
				});
			}.bind(this),
			userLeaveCallback: function (id) {
				console.log(id);
			}
		});
		this.getWs(function (ws) {
			ws.send(JSON.stringify(['HANDSHAKE', this.data.room]));
			this._ws = ws;
		}.bind(this));
		this.tick = AFRAME.utils.throttleTick(this.throttledTick, 1000/15, this);
	},
	throttledTick: function () {
		if (!this._ws) return;
		var toSerial = Array.from(this.objects.values())
		.filter(function (el) {
			return el.components['fast-sync'].id !== undefined;
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
			bindata[0 + index] = el.components['fast-sync'].id;
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
	onbinary: function (ws, message) {
		var index = 0;
		while (index < message.length) {
			var id = message[index];
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
		if (details.html) {
			this.sceneEl.insertAdjacentHTML('beforeend', details.html);
			var el = this.sceneEl.lastElementChild;
			el.setAttribute('fast-sync-listener', 'original: ' + id + ' ; to: ' + details.syncId + ';');
			el.removeAttribute('fast-sync');
			this.foreignObjects.set(id + ',' + details.syncId, el);
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
			el.components['fast-sync'].getSyncTemplate().then(function (template) {
				ws.send(JSON.stringify(['UPDATE_REMOTE_EL', template]));
			});
		});
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
})

AFRAME.registerComponent('fast-sync', {
	schema: {

		'world-position': {
			default: false
		},
		
		'world-rotation': {
			default: false
		},

		// clone an element by selector on the remote
		clone: {
			default: ''
		},

		// Instead of copying self, copy another element
		copy: {
			type: 'selector'
		},

		components: {
			default: 'material, color'
		}
	},
	init: function () {
		this._registerPromise = this.el.sceneEl.systems['fast-sync-controller']
		.register(this.el)
		.then(function (id) {
			this.id = id;	
		}.bind(this));
	},
	update: function () {
		var controller = this.el.sceneEl.systems['fast-sync-controller'];
		controller.updateEl.call(controller, this.el);
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
		return this._registerPromise.then(function () {
			var config = this.data;
			var syncId = this.id;
			var components = this.data.components.split(',').map(function (s) {
				return s.toLowerCase().trim();
			});
	
			if (config.clone) {
				return {
					clone: config,
					syncId: syncId
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
				syncId: syncId
			};
		}.bind(this));
	},
	remove: function () {
		
	}
})