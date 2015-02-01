/**
 * FLL Message Server (MServer).
 *
 * Makes MServer pubsub Nodes available through WebSockets.
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import express = require("express");
import http = require("http");
import pubsub = require("./pubsub");
import SocketHub = require("./SocketHub");
import Message = require("./Message");

var app = express();

//app.use("/", express.static(__dirname + "/static"));

var PORT = process.env.PORT || 13900;
var server = http.createServer(app);
server.listen(PORT, (): void => {
	console.log("Listening on " + PORT);
});
server.on("error", (e: Error): void => {
	console.log("Webserver error:", e);
});

// TODO: Make this stuff configurable instead of hard-coded
var blib = new pubsub.Node("blib");
var twitter = new pubsub.Node("twitter");
var twitterbar = new pubsub.Node("twitterbar");
var controller = new pubsub.Node("controller");
var proxy = new pubsub.Node("proxy");

twitter.bind(twitterbar, "twitter:{add,remove}"); // twitter:add and twitter:remove go to twitterbar
controller.bind(twitterbar, "twitter:{show,hide}"); // controller is in charge of hide/show of twitterbar
proxy.bind(twitterbar, "twitter:{show,hide}"); // Show/hide buttons on 'old' Overlay Controller can also be used

var hub = new SocketHub(server);
hub.add(blib);
hub.add(twitter);
hub.add(twitterbar);
hub.add(controller);
hub.add(proxy);

var blibCount = 0;
setInterval((): void => {
	blib.send(new Message("blib", blibCount++));
}, 5000);
