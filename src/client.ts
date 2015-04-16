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
	"Pipe mode: $0 [-s <host>[:<port>]] -n <nodename> -t <topic> -i <input_format> [-h <json_headers>]",
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
	})
	.option("i", {
		type: "string",
		alias: "input",
		description: "Read lines from stdin, post each line to server. <input_format> can be: text, json"
	})
	.strict();

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

enum Format {
	Json,
	Text
}

function parseFormat(s: string): Format {
	switch (s) {
		case "text":
			return Format.Text;
		case "json":
			return Format.Json;
		default:
			die("Invalid format:", s);
	}
}

function pipeMode(): void {
	var argv = args
		.require("topic", true)
		.argv;

	var format = parseFormat(argv.input);

	var headers: any;
	try {
		headers = argv.headers && JSON.parse(argv.headers);
	} catch (e) {
		die("Error parsing message headers as JSON: " + e.message);
	}

	var ended = false;
	var client = new MClient("ws://" + argv.socket);
	var lineBuffer = "";
	client.on("open", (): void => {
		// Connection opened, start reading lines from stdin
		process.stdin.setEncoding("utf8");
		process.stdin.on("readable", onRead);
		process.stdin.on("end", onEnd);

	});
	client.on("error", (e: Error): void => {
		die("Socket error:", e);
	});

	function onRead(): void {
		var chunk = process.stdin.read();
		if (chunk === null) {
			return;
		}
		lineBuffer += chunk;
		while (true) {
			var p = lineBuffer.indexOf("\n");
			if (p < 0) {
				break;
			}
			handleLine(lineBuffer.slice(0, p));
			lineBuffer = lineBuffer.slice(p + 1);
		};
	}

	function onEnd(): void {
		ended = true;
		if (lineBuffer !== "") {
			// Make sure to post remaining line, if non-empty
			handleLine(lineBuffer);
		} else {
			// Otherwise, we're done
			client.close();
		}
	}

	function handleLine(line: string): void {
		// Strip trailing \r if necessary
		if (line[line.length - 1] === "\r") {
			line = line.slice(0, -1);
		}
		var data: any;
		if (format === Format.Json) {
			try {
				data = JSON.parse(line);
			} catch (e) {
				die("Error parsing line as JSON: " + e.message);
			}
		} else {
			data = line;
		}

		client.publish(argv.node, argv.topic, data, headers, (): void => {
			if (ended) {
				client.close();
			}
		});
	}
}

var argv = args.argv;

if (argv.listen) {
	listenMode();
} else if (argv.topic) {
	if (argv.input) {
		pipeMode();
	} else {
		postMode();
	}
} else {
	die("Either -l or -t is required, see --help for more info.");
}
