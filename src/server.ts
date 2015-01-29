/// <reference path="../typings/tsd.d.ts" />

"use strict";

import express = require("express");
import http = require("http");
import pubsub = require("./pubsub");
import SocketHub = require("./SocketHub");

var app = express();

//app.use("/", express.static(__dirname + "/static"));

var PORT = process.env.PORT || 13900;
var server = http.createServer(app);
server.listen(PORT, (): void => {
	console.log("Listening on " + PORT);
});

var blib = new pubsub.Node("blib");
var test = new pubsub.Node("test");
var firehose = new pubsub.Node("firehose");
var queue = new pubsub.Queue("queue", 3);

blib.bind(test);
test.bind(firehose);
blib.bind(queue);

var hub = new SocketHub(server);
hub.add(blib);
hub.add(firehose);
hub.add(queue);

var blibCount = 0;
setInterval((): void => {
	blib.send(new pubsub.Message("blib", blibCount++));
}, 5000);
