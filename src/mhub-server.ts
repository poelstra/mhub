/**
 * MHub server (mserver)
 *
 * Makes MHub pubsub Nodes available through WebSockets.
 */

"use strict";

import "source-map-support/register";

import * as express from "express";
import * as http from "http";
import * as https from "https";
import * as yargs from "yargs";
import * as path from "path";
import * as fs from "fs";
import * as pubsub from "./pubsub";
import SocketHub from "./sockethub";
import { KeyValues } from "./types";
import { TlsOptions, replaceKeyFiles } from "./tls";

import log from "./log";

interface Binding {
	from: string;
	to: string;
	pattern?: string;
}

interface ListenOptions extends TlsOptions {
	port?: number;
}

interface NodeDefinition {
	type: string;
	options?: { [key: string]: any; };
}

interface Config {
	listen?: ListenOptions;
	port?: number;
	verbose?: boolean;
	bindings?: Binding[];
	nodes: string[] | { [nodeName: string]: string | NodeDefinition; };
}

function die(...args: any[]): void {
	console.error.apply(this, args);
	process.exit(1);
}

// Register known node types

import ConsoleDestination from "./nodes/consoleDestination";
import Exchange from "./nodes/exchange";
import PingResponder from "./nodes/pingResponder";
import Queue from "./nodes/queue";
import TestSource from "./nodes/testSource";
import TopicQueue from "./nodes/topicQueue";

interface ConstructableNode {
	new(name: string, options?: KeyValues<any>): pubsub.Source | pubsub.Destination;
}

const nodeClasses: ConstructableNode[] = [
	ConsoleDestination,
	Exchange,
	PingResponder,
	Queue,
	TestSource,
	TopicQueue,
];

const nodeClassMap: { [className: string]: ConstructableNode } = {};
nodeClasses.forEach((c) => {
	nodeClassMap[c.name] = c;
});

// Parse input arguments

var args = yargs
	.usage("mhub-server [-c <config_file>]")
	.help("help")
	.alias("h", "help")
	// tslint:disable-next-line:no-require-imports
	.version(() => require(path.resolve(__dirname, "../../package.json")).version)
	.alias("v", "version")
	.option("c", {
		type: "string",
		alias: "config",
		description: "Filename of config, uses mhub's server.conf.json by default",
	})
	.strict()
	.argv;

// Parse config file

var configFile: string;
if (!args.config) {
	configFile = path.resolve(__dirname, "../../server.conf.json");
} else {
	configFile = path.resolve(args.config);
}

try {
	var config: Config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (e) {
	die(`Cannot parse config file '${configFile}':`, e);
}

// Enable verbose logging by default, can be explicitly set to enabled/disabled
// in the config file
if (config.verbose !== undefined && !config.verbose) {
	log.onMessage = undefined;
}

log.write("Using config file " + configFile);

// 'Normalize' config and convert paths to their contents
if (!config.nodes) {
	die("Invalid configuration: missing `nodes`");
}
if (config.port) {
	if (config.listen) {
		die("Invalid configuration: specify either `port` or `listen`");
	}
	config.listen = {
		port: config.port,
	};
	delete config.port;
}
if (config.listen) {
	// Read TLS key, cert, etc
	replaceKeyFiles(config.listen, path.dirname(configFile));
}
if (!config.bindings) {
	config.bindings = [];
}

// Instantiate websocket server

var app = express();

var server: http.Server | https.Server;
const useTls = !!(config.listen.key || config.listen.pfx);

if (useTls) {
	server = https.createServer(config.listen, app);
} else {
	server = http.createServer(app);
}

server.listen(config.listen.port, (): void => {
	log.write("Listening on port " + config.listen.port, useTls ? "(TLS)" : "");
});
server.on("error", (e: Error): void => {
	die("Webserver error:", e);
});

var hub = new SocketHub(server);

// Instantiate nodes from config file

if (Array.isArray(config.nodes)) { // Backward compatibility, convert to new format
	const oldNodes = <string[]>config.nodes;
	config.nodes = {};
	oldNodes.forEach((n: string) => {
		if (typeof n !== "string") {
			die("Invalid configuration: `nodes` is given as array, and must then contain only strings");
		}
		config.nodes[n] = {
			type: "Exchange",
		};
	});
}

if (typeof config.nodes !== "object") {
	die("Invalid configuration: `nodes` should be a NodeDefinition map, or an array of strings");
}

Object.keys(config.nodes).forEach((nodeName: string): void => {
	let def = config.nodes[nodeName];
	if (typeof def === "string") {
		def = <NodeDefinition>{
			type: def,
		};
	}
	const typeName = def.type;
	const nodeConstructor = nodeClassMap[typeName];
	if (!nodeConstructor) {
		die(`Unknown node type '${typeName}' for node '${nodeName}'`);
	}
	const node = new nodeConstructor(nodeName, def.options);
	hub.add(node);
});

// Setup bindings between nodes

config.bindings.forEach((binding: Binding, index: number): void => {
	var from = hub.findSource(binding.from);
	if (!from) {
		die(`Unknown Source node '${binding.from}' in \`binding[${index}].from\``);
	}
	var to = hub.findDestination(binding.to);
	if (!to) {
		die(`Unknown Destination node '${binding.to}' in \`binding[${index}].to\``);
	}
	from.bind(to, binding.pattern);
});
