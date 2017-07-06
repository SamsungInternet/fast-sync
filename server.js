/*
* Refactor as a node module.
*/

/* eslint-env es6 */
/* eslint no-console: 0 */
'use strict';

const server = require('http').createServer();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const fastSync = require('./lib/fast-sync');

// Options from https://github.com/websockets/ws/blob/master/doc/ws.md
fastSync(server, {
	path: '/fast-sync/'
});

app.use('/dist', express.static('dist', {
	maxAge: 3600 * 1000 * 24
}));

app.use(express.static('static', {
	maxAge: 3600 * 1000 * 24
}));

server.on('request', app);

server.listen(port, function () {
	console.log('Listening on ' + server.address().port)
});
