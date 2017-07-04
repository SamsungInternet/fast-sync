/*
* Refactor as a node module.
*/

/* eslint-env es6 */
'use strict';

const server = require('http').createServer();
const WebSocketServer = require('uws').Server;
const wss = new WebSocketServer({ server: server });
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const SYNC_INTERVAL = 1000/15;

// 0th entry is always filled
let ids = [true];

function wsHandleErr(e) {
	if (e) {
		console.log(e.message);
		console.log('Oh no! ' + Date.now());
	}
}

app.use(express.static('static', {
	maxAge: 3600 * 1000 * 24
}));

wss.on('connection', function connection(ws) {
	let id = ids.indexOf(false);
	if (id === -1) {
		id = ids.push(true) - 1;
	}
	ws.id = id;
	ws._size = 0;


	ws.on('close', function close() {
		const roomies = [];
		wss.clients.forEach(function (ws) {
			if(ws._room === this._room) roomies.push(ws);
		}.bind(this));

		const roomiesIds = roomies.map(ws => ws.id);
	
		roomies.forEach(function (ws) {
			ws.send(JSON.stringify(['UPDATE_USERS', roomiesIds]), wsHandleErr);
		});
	});

	ws.on('message', function incoming(message) {

		// Rebroadcast any string messages
		if (typeof message === 'string') {

			// The binary data is now invalid so set the _size to zero
			if (ws._size) {
				ws._size = 0;
			}

			if (message === '__ping__') {
				return ws.send('__pong__', wsHandleErr);
			}
			let data;
			try {
				data = JSON.parse(message);
			} catch(e) {
				console.log('INVALID JSON:' + message);
				return;
			}
			if (data[0] === 'HANDSHAKE') {
				console.log('user with id', id, 'joined room', data[1]);

				ws._room = data[1];

				const roomies = [];
				wss.clients.forEach(function (ws) {
					if(ws._room === data[1]) roomies.push(ws);
				});

				const roomiesIds = roomies.map(ws => ws.id);
				roomiesIds.push(id);
				roomies.forEach(function (ws) {
					ws.send(JSON.stringify(['UPDATE_USERS', roomiesIds]), wsHandleErr);
				});

				return;
			}

			// By default rebroadcast

			// send to specific user
			if (data.length === 3) {
				message = JSON.stringify([
					data[0],
					id,
					data[2]
				]);
				wss.clients
				.forEach(function (otherWs) {
					if (!otherWs.id === data[1]) return;
					otherWs.send(message);
				});
				return;
			}

			// send to everyone
			if (data.length === 2) {
				message = JSON.stringify([
					data[0],
					id,
					data[1]
				]);
				wss.clients.forEach(function (otherWs) {
					if(otherWs !== ws) otherWs.send(message);
				});
				return;
			}
		} else {
			ws._buffer = Buffer.from(message);
			ws._size = message.byteLength;
		}
	});

	ws.isAlive = true;
	ws.on('pong', heartbeat);

	ws.send(JSON.stringify(['HANDSHAKE', id]), wsHandleErr);
});

server.on('request', app);
server.listen(port, function () {
	console.log('Listening on ' + server.address().port)
});

function heartbeat() {
	this.isAlive = true;
}

setInterval(function ping() {
	wss.clients.forEach(function each(ws) {
		if (ws.isAlive === false) return ws.terminate();

		ws.isAlive = false;
		ws.ping('', false, true);
	});
}, 5000);

setInterval(function () {
	const rooms = {};
	wss.clients.forEach(function (ws) {

		// ignore rooms which don't have binary data
		var room = rooms[ws._room] || {
			buffer: [],
			clients: [],
			size: 0
		};
		rooms[ws._room] = room;
		room.clients.push(ws);
		
		if (ws._size) {
			room.buffer.push(ws._buffer);
			room.size += ws._size;
		}

		ws._buffer = undefined;
		ws._size = 0;
	});
	const roomKeys = Object.keys(rooms);
	for (const roomKey of roomKeys) {
		const room = rooms[roomKey];
		if (!room.size) continue;
		const data = Buffer.concat(room.buffer, room.size);
		for (const ws of room.clients) {
			ws.send(data, wsHandleErr);
		};
	}
}, SYNC_INTERVAL);
