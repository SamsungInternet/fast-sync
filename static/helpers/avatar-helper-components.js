/* global AFRAME, THREE */
/* eslint no-var: 0 */

AFRAME.registerComponent('ada-model', {
	schema: {
		mouth: {
			default: '0'
		},
		eyes: {
			default: '0'
		}
	},
	init: function() {

		this.intervals = [];

		this.el.addEventListener('model-loaded', function() {

			//Mouth 
			this.el.object3D.children[0].children[2].material.transparent = true;
			this.mouth = this.el.object3D.children[0].children[2];

			// Eyes
			this.el.object3D.children[0].children[1].material.transparent = true;
			this.eyes = this.el.object3D.children[0].children[1];

			// The glasses
			this.el.object3D.children[0].children[3].material.side = THREE.DoubleSide;

			// The head
			this.el.object3D.children[0].children[0].material.needsUpdate = true;
			this.update();
		}.bind(this));
	},

	update: function() {
		this.remove();
		if (!this.eyes || !this.mouth) return;
		if (this.data.mouth === 'anim') {
			this.intervals.push(setInterval(function () {
				this.mouth.material.map.offset.y = Math.floor(7 * Math.random()) / 7;
			}.bind(this), 200));
		} else {
			this.mouth.material.map.offset.y = Number(this.data.mouth) / 7;
		}
		if (this.data.eyes === 'anim') {
			this.intervals.push(setInterval(function () {
				this.eyes.material.map.offset.y = Math.floor(4 * Math.random()) / 4;
			}.bind(this), 1000));
		} else {
			this.eyes.material.map.offset.y = Number(this.data.eyes) / 4;
		}
	},

	remove: function () {
		this.intervals.splice(0).forEach(function (i) {
			clearInterval(i);
		});
	}
});

AFRAME.registerComponent('circle-around', {
	schema: {
		radius: {
			default: 3
		},
		origin: {
			type: 'vec3',
			default: {
				x: 0,
				y: 1.4,
				z: 0
			}
		}
	},
	update: function () {
		var pos = this.el.object3D.position.clone().set(
			-.5 + Math.random(),
			0,
			-.5 + Math.random()
		).normalize().multiplyScalar(this.data.radius);
		this.el.setAttribute('position', pos);
		this.el.object3D.lookAt(this.data.origin);
	}
})

AFRAME.registerComponent('student-model', {
	schema: {
		color1: {
			type: 'color',
			default: 'random'
		},
		color2: {
			type: 'color',
			default: 'random'
		}
	},
	init: function() {
		this.el.addEventListener('model-loaded', function() {
			this.hasLoaded = true;
			this.update();
		}.bind(this));
	},
	update: function() {
		if (this.data.color1 === 'random') {
			this.data.color1 = 'hsl(' + Math.random() * 360 + ', 100%, 60%)';
		}
		if (this.data.color2 === 'random') {
			this.data.color2 = 'hsl(' + Math.random() * 360 + ', 100%, 80%)';
		}
		if (this.hasLoaded) {
			this.el.object3D.children[0].rotation.y = Math.PI;
			this.el.object3D.children[0].position.y = -2;
			var oldMat = this.el.object3D.children[0].children[0].material;
			this.el.object3D.children[0].children[0].material = new THREE.MeshBasicMaterial();
			this.el.object3D.children[0].children[0].material.color = new THREE.Color(this.data.color1);
			this.el.object3D.children[0].children[0].material.map = oldMat.map;
			this.el.object3D.children[0].children[0].material.fog = false;
		
			this.el.object3D.children[0].children[1].material.color = new THREE.Color(this.data.color2);
		}
	}
});

AFRAME.registerComponent('clone', {
	schema: {
		type: 'selector'
	},

	init: function () {
		this.updateFn = this.update.bind(this);
	},

	update: function () {
		if (!this.data) throw Error('No clone failed, selector returned null');
		if (!this.data.getObject3D('mesh')) {
			this.data.addEventListener('model-loaded', this.updateFn);
			return;
		}
		this.remove();
		var cloneGeom = this.data.getObject3D('mesh').clone(true);
		cloneGeom.visible = true;
		this.el.setObject3D('clone', cloneGeom);
		this.oldEl = this.data;
		this.el.emit('model-loaded');
	},

	remove: function () {
		if (this.oldEl) { this.oldEl.removeEventListener('model-loaded', this.updateFn); }
		if (this.el.getObject3D('clone')) this.el.removeObject3D('clone');
	}
});
