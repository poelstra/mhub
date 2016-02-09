/**
 * Commandline tool for sending/receiving MHub messages to/from an mserver.
 */

"use strict";

import * as yargs from "yargs";
import * as path from "path";
import MClient from "./MClient";
import Message from "./Message";

var usage = [
	"Listen mode: $0 [-s <host>[:<port>]] [-n <nodename>] -l [-p <topic_pattern>] [-o <output_format>]",
	"Post mode: $0 [-s <host>[:<port>]] [-n <nodename>] -t <topic> [-d <json_data>] [-h <json_headers>]",
	"Pipe mode: $0 [-s <host>[:<port>]] [-n <nodename>] -t <topic> -i <input_format> [-h <json_headers>]",
].join("\n");

function die(...args: any[]): void {
	console.error.apply(this, args);
	process.exit(1);
}

var args = yargs
	.usage(usage)
	.help("help")
	.version(() => require(path.resolve(__dirname, "../../package.json")).version, "version")
	.alias("v", "version")
	.option("s", {
		type: "string",
		alias: "socket",
		description: "WebSocket to connect to",
		required: true,
		default: "localhost:13900"
	})
	.option("n", {
		type: "string",
		alias: "node",
		description: "Node to subscribe/publish to, e.g. 'test'",
		required: true,
		default: "default"
	})
	.option("l", {
		type: "boolean",
		alias: "listen",
		description: "Select listen mode"
	})
	.option("p", {
		type: "string",
		alias: "pattern",
		description: "Topic subscription pattern as glob, e.g. 'twitter:*'"
	})
	.option("o", {
		type: "string",
		alias: "output",
		description: "Output format, can be: human, text, jsondata, json",
		default: "human"
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

enum OutputFormat {
	Human,
	Text,
	JsonData,
	Json
}

function parseOutputFormat(s: string): OutputFormat {
	switch (s) {
		case "human":
			return OutputFormat.Human;
		case "text":
			return OutputFormat.Text;
		case "jsondata":
			return OutputFormat.JsonData;
		case "json":
			return OutputFormat.Json;
		default:
			die("Invalid output format:", s);
	}
}

function listenMode(): void {
	var argv = args.argv;
	var format = parseOutputFormat(argv.output);
	var client = new MClient("ws://" + argv.socket);
	client.on("open", (): void => {
		client.subscribe(argv.node, argv.pattern);
	});
	client.on("message", (msg: Message): void => {
		switch (format) {
			case OutputFormat.Human:
				console.log(msg);
				break;
			case OutputFormat.Text:
				console.log(msg.data);
				break;
			case OutputFormat.JsonData:
				console.log(JSON.stringify(msg.data));
				break;
			case OutputFormat.Json:
				console.log(JSON.stringify(msg));
				break;
		}
	});
	client.on("error", (e: Error): void => {
		die("Client error:", e);
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
		console.error("Error parsing message data as JSON:", e.message);
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
		let closer = () => client.close();
		client.publish(argv.node, argv.topic, data, headers).then(closer, closer);
	});
	client.on("error", (e: Error): void => {
		die("Client error:", e);
	});
}

enum InputFormat {
	Text,
	Json
}

function parseInputFormat(s: string): InputFormat {
	switch (s) {
		case "text":
			return InputFormat.Text;
		case "json":
			return InputFormat.Json;
		default:
			die("Invalid input format:", s);
	}
}

function pipeMode(): void {
	var argv = args
		.require("topic", true)
		.argv;

	var format = parseInputFormat(argv.input);

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
		die("Client error:", e);
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
		if (format === InputFormat.Json) {
			try {
				data = JSON.parse(line);
			} catch (e) {
				die("Error parsing line as JSON: " + e.message);
			}
		} else {
			data = line;
		}

		let closer = () => {
			if (ended) {
				client.close();
			}
		};
		client.publish(argv.node, argv.topic, data, headers).then(closer, closer);
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
