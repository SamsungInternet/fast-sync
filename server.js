/* eslint-env es6 */
/* eslint no-console: 0 */
'use strict';

const server = require('http').createServer();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const fastSync = require('./');

// Options from https://github.com/websockets/ws/blob/master/doc/ws.md
// Set up the WebSocket Server;
const wss = fastSync(server, {
	path: '/fast-sync/',
	debug: true
});

// Make the client side script available on /fast-sync/
app.use(wss.dist);

app.use(express.static('demos', {
	maxAge: 3600 * 1000 * 24
}));

server.on('request', app);

server.listen(port, function () {
	console.log('Listening on ' + server.address().port)
});
