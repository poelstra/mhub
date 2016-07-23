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
import * as net from "net";
import * as ws from "ws";
import Promise from "ts-promise";
import * as pubsub from "./pubsub";
import * as storage from "./storage";
import Hub from "./hub";
import WSConnection from "./transports/wsconnection";
import TcpConnection from "./transports/tcpconnection";
import { KeyValues } from "./types";
import { TlsOptions, replaceKeyFiles } from "./tls";

import log from "./log";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;
const DEFAULT_PORT_TCP = 13902;

interface Binding {
	from: string;
	to: string;
	pattern?: string;
}

interface WSServerOptions extends TlsOptions {
	type: "websocket";
	port?: number; // default 13900 (ws) or 13901 (wss)
}

interface TcpServerOptions {
	type: "tcp";
	host?: string; // NodeJS default (note: will default to IPv6 if available!)
	port?: number; // default 13902
	backlog?: number; // NodeJS default, typically 511
}

interface NodeDefinition {
	type: string;
	options?: { [key: string]: any; };
}

type ListenOptions = WSServerOptions | TcpServerOptions;

interface Config {
	listen?: ListenOptions | ListenOptions[];
	port?: number;
	verbose?: boolean;
	bindings?: Binding[];
	nodes: string[] | { [nodeName: string]: string | NodeDefinition; };
	storage: string;
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
import TopicStore from "./nodes/topicStore";

interface ConstructableNode {
	new(name: string, options?: KeyValues<any>): pubsub.Source | pubsub.Destination;
}

const nodeClasses: ConstructableNode[] = [
	ConsoleDestination,
	Exchange,
	PingResponder,
	Queue,
	TestSource,
	TopicStore,
];

const nodeClassMap: { [className: string]: ConstructableNode } = {};
nodeClasses.forEach((c) => {
	nodeClassMap[c.name] = c;
});

// For backward compatibility
/* tslint:disable:no-string-literal */
nodeClasses["TopicQueue"] = TopicStore;
nodeClasses["TopicState"] = TopicStore;
/* tslint:enable:no-string-literal */

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
		type: "websocket",
		port: config.port,
	};
	delete config.port;
}
if (!config.listen) {
	die("Invalid configuration: `port` or `listen` missing");
}
if (!Array.isArray(config.listen)) {
	config.listen = [config.listen];
}
config.listen.forEach((listen: ListenOptions) => {
	if (!listen.type) {
		// Default to WebSocket, for backward compatibility
		listen.type = "websocket";
	}
	if (listen.type === "websocket") {
		// Read TLS key, cert, etc
		replaceKeyFiles(listen, path.dirname(configFile));
	}
});

if (!config.bindings) {
	config.bindings = [];
}

// Create default storage

const storageRoot = path.resolve(path.dirname(configFile), config.storage || "./storage");
const simpleStorage = new storage.ThrottledStorage(new storage.SimpleFileStorage<any>(storageRoot));
storage.setDefaultStorage(simpleStorage);

var hub = new Hub();

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

// Initialize and start server

let connectionId = 0;

function startWebSocketServer(options: WSServerOptions): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		options = Object.create(options);
		const app = express();

		let server: http.Server | https.Server;
		const useTls = !!(options.key || options.pfx);

		options.port = options.port || (useTls ? DEFAULT_PORT_WS : DEFAULT_PORT_WSS);

		if (useTls) {
			server = https.createServer(options, app);
		} else {
			server = http.createServer(app);
		}

		const wss = new ws.Server({ server: <any>server, path: "/" });
		wss.on("connection", (conn: ws) => {
			new WSConnection(hub, conn, "websocket" + connectionId++);
		});

		server.listen(options.port, (): void => {
			log.write("WebSocket Server started on port " + options.port, useTls ? "(TLS)" : "");
			resolve(undefined);
		});

		server.on("error", (e: Error): void => {
			reject(e);
		});
	});
}

function startTcpServer(options: TcpServerOptions): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		options = Object.create(options);
		options.port = options.port || DEFAULT_PORT_TCP;

		const server = net.createServer((socket: net.Socket) => {
			new TcpConnection(hub, socket, "tcp" + connectionId++);
		});

		server.listen(
			{
				port: options.port,
				host: options.host,
				backlog: options.backlog,
			},
			(): void => {
				log.write("TCP Server started on port " + options.port);
				resolve(undefined);
			}
		);

		server.on("error", (e: Error): void => {
			reject(e);
		});
	});
}

function startTransports(): Promise<void> {
	const serverOptions = Array.isArray(config.listen) ? config.listen : [config.listen];
	return Promise.all(
		serverOptions.map((options: ListenOptions) => {
			switch (options.type) {
				case "websocket":
					return startWebSocketServer(<WSServerOptions>options);
				case "tcp":
					return startTcpServer(<TcpServerOptions>options);
				default:
					throw new Error(`unsupported transport '${options!.type}'`);
			}
		})
	).return();
}

hub.init().then(startTransports).catch((err: Error) => {
	die(`Failed to initialize:`, err);
});
