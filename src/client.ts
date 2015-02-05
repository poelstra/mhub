/**
 * Commandline tool for sending/receiving mserver messages.
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import yargs = require("yargs");
import MClient = require("./MClient");
import Message = require("./Message");

var usage = [
	"Listen mode: $0 [-s <host>[:<port>]] -n <nodename> -l",
	"Post mode: $0 [-s <host>[:<port>]] -n <nodename> -t <topic> [-d <json_data>] [-h <json_headers>]",
].join("\n");

function die(...args: any[]): void {
	console.log.apply(this, args);
	process.exit(1);
}

var args = yargs
	.usage(usage)
	.help("help")
	.option("s", {
		type: "string",
		alias: "socket",
		description: "WebSocket to connect to",
		default: "localhost:13900"
	})
	.option("n", {
		type: "string",
		alias: "node",
		description: "Node to subscribe/publish to",
		required: true
	})
	.option("l", {
		type: "boolean",
		alias: "listen",
		description: "Select listen mode"
	})
	.option("t", {
		type: "string",
		alias: "topic",
		description: "Message topic"
	})
	.option("d", {
		type: "string",
		alias: "data",
		description: "Optional message data as JSON object, e.g. '\"a string\"' or '{ \"foo\": \"bar\" }'"
	})
	.option("h", {
		type: "string",
		alias: "headers",
		description: "Optional message headers as JSON object, e.g. '{ \"my-header\": \"foo\" }'"
	});

function listenMode(): void {
	var argv = args.argv;
	var client = new MClient("ws://" + argv.socket);
	client.on("open", (): void => {
		client.subscribe(argv.node);
	});
	client.on("message", (msg: Message): void => {
		console.log(msg);
	});
	client.on("error", (e: Error): void => {
		die("Socket error:", e);
	});
}

function postMode(): void {
	var argv = args
		.require("topic", true)
		.argv;

	var data: any;
	try {
		data = argv.data && JSON.parse(argv.data);
	} catch (e) {
		console.log("Error parsing message data as JSON: " + e.message);
		die(
			"Hint: if you're passing a string, make sure to put double-quotes around it, " +
			"and escape these quotes for your shell with single-quotes, e.g.: '\"my string\"'"
		);
	}

	var headers: any;
	try {
		headers = argv.headers && JSON.parse(argv.headers);
	} catch (e) {
		die("Error parsing message headers as JSON: " + e.message);
	}

	var client = new MClient("ws://" + argv.socket);
	client.on("open", (): void => {
		client.publish(argv.node, argv.topic, data, headers, (): void => {
			client.close();
		});
	});
	client.on("error", (e: Error): void => {
		die("Socket error:", e);
	});
}

var argv = args.argv;

if (argv.listen) {
	listenMode();
} else if (argv.topic) {
	postMode();
} else {
	die("Either -l or -t is required, see --help for more info.");
}
