# A-Frame fast-sync

Used to efficiently sync the position and rotation of 100s of A-Frame objects at 30fps, ritten to be as fast and light as possible.

# Usage

Requires a Node server,

```
npm install --save fast-sync
```

## In your server:

There is a complete example in [server.js](https://github.com/AdaRoseEdwards/fast-sync/blob/master/server.js)

```
const server = require('http').createServer();

// Options from https://github.com/websockets/ws/blob/master/doc/ws.md
// Set up the WebSocket Server;
const wss = fastSync(server, {
	path: '/fast-sync/',
	debug: true
});
```

## On the client

Include the dist file in your client:

```
<head>
  <script src="https://aframe.io/releases/0.6.0/aframe.min.js"></script>
  <script src="/fast-sync/fast-sync-component.js"></script>
</head>
```
## Configure the aframe system:

By default it uses the room 'demo' and the url as the url of the page + '/fast-sync/'

```
<a-scene fast-sync-controller="room: demo; url: wss://example.com;">
  ...
</a-scene>

```

## Simple syncing

When it is initiated it will clone itself onto any remote users with the following components copied:

material, color, shadow, id, class, geometry, scale

As well as any components defined in components.

```
<a-box fast-sync="components: foo;" foo="bar">
	<a-animation from="0 0 0" to="0 90 0" repeat="indefinite" easing="linear" end="stolen"></a-animation> 
</a-box>
```

30 times a second it will sync it's position with the server.

