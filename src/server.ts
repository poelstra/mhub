/**
 * FLL Message Server (MServer).
 *
 * Makes MServer pubsub Nodes available through WebSockets.
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import express = require("express");
import http = require("http");
import yargs = require("yargs");
import path = require("path");
import fs = require("fs");
import pubsub = require("./pubsub");
import SocketHub = require("./SocketHub");
import Message = require("./Message");

import d = require("./debug");
import debug = d.debug;

var args = yargs
	.usage("$0 [-c <config_file>]")
	.help("help")
	.option("c", {
		type: "string",
		alias: "config",
		description: "Filename of config",
		default: "server.conf.json"
	})
	.argv;

var configFile = path.resolve(args.config);
console.log("Using config file " + configFile);
var config = JSON.parse(fs.readFileSync(configFile, "utf8"));

var app = express();

//app.use("/", express.static(__dirname + "/static"));

var server = http.createServer(app);
server.listen(config.port, (): void => {
	console.log("Listening on " + config.port);
});
server.on("error", (e: Error): void => {
	console.log("Webserver error:", e);
});

var hub = new SocketHub(server);

config.nodes.forEach((nodeName: string): void => {
	var node = new pubsub.Node(nodeName);
	hub.add(node);
});

interface Binding {
	from: string;
	to: string;
	pattern?: string;
}

config.bindings.forEach((binding: Binding): void => {
	var from = hub.find(binding.from);
	if (!from) {
		throw new Error("Unknown node '" + binding.from + "'");
	}
	var to = hub.find(binding.to);
	if (!to) {
		throw new Error("Unknown node '" + binding.to + "'");
	}
	from.bind(to, binding.pattern);
});

// Automatically send blibs when a blib node is configured, useful for testing
var blibNode = hub.find("blib");
if (blibNode) {
	var blibCount = 0;
	setInterval((): void => {
		blibNode.send(new Message("blib", blibCount++));
	}, 5000);
}

class PingResponder implements pubsub.Destination {
	constructor(public name: string, private pingNode: pubsub.Node) {
		this.pingNode.bind(this, "ping:request");
	}

	send(message: Message): void {
		debug.push("-> %s", this.name, message.topic);
		this.pingNode.send(new Message("ping:response", message.data));
		debug.pop();
	}
}

// Automatically respond to pings when a ping node is configured, useful for testing
var pingNode = hub.find("ping");
if (pingNode) {
	var pongNode = new PingResponder("pong", pingNode);
}
