import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as ws from "ws";

import Promise from "ts-promise";
import { PlainAuthenticator } from "./authenticator";
import Hub, { UserRights } from "./hub";
import { TlsOptions } from "./tls";
import TcpConnection from "./transports/tcpconnection";
import WSConnection from "./transports/wsconnection";

import * as pubsub from "./pubsub";
import { KeyValues } from "./types";

import log from "./log";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;
const DEFAULT_PORT_TCP = 13902;

export interface Binding {
	from: string;
	to: string;
	pattern?: string;
}

export interface WSServerOptions extends TlsOptions {
	type: "websocket";
	port?: number; // default 13900 (ws) or 13901 (wss)
}

export interface TcpServerOptions {
	type: "tcp";
	host?: string; // NodeJS default (note: will default to IPv6 if available!)
	port?: number; // default 13902
	backlog?: number; // NodeJS default, typically 511
}

export interface NodeDefinition {
	type: string;
	options?: { [key: string]: any; };
}

export interface NodesConfig {
	[nodeName: string]: string | NodeDefinition;
}

export type ListenOptions = WSServerOptions | TcpServerOptions;

export interface Config {
	listen?: ListenOptions | ListenOptions[];
	port?: number;
	verbose?: boolean;
	logging?: "none" | "fatal" | "error" | "warning" | "info" | "debug";
	bindings?: Binding[];
	nodes: string[] | NodesConfig;
	storage?: string;
	users?: string | { [username: string]: string };
	rights: UserRights;
}

export interface NormalizedConfig {
	listen: ListenOptions[];
	verbose?: boolean;
	logging?: "none" | "fatal" | "error" | "warning" | "info" | "debug";
	bindings: Binding[];
	nodes: NodesConfig;
	storage: string;
	users: { [username: string]: string };
	rights: UserRights;
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
	nodeClassMap[(<any>c).name] = c;
});

// For backward compatibility
/* tslint:disable:no-string-literal */
nodeClassMap["TopicQueue"] = TopicStore;
nodeClassMap["TopicState"] = TopicStore;
/* tslint:enable:no-string-literal */

// Initialize and start server

let connectionId = 0;
function startWebSocketServer(hub: Hub, options: WSServerOptions): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		options = { ...options }; // clone

		let server: http.Server | https.Server;
		const useTls = !!(options.key || options.pfx);

		options.port = options.port || (useTls ? DEFAULT_PORT_WSS : DEFAULT_PORT_WS);

		if (useTls) {
			server = https.createServer(options);
		} else {
			server = http.createServer();
		}

		const wss = new ws.Server({ server: <any>server, path: "/" });
		wss.on("connection", (conn: ws) => {
			// tslint:disable-next-line:no-unused-expression
			new WSConnection(hub, conn, "websocket" + connectionId++);
		});

		server.listen(options.port, (): void => {
			log.info("WebSocket Server started on port " + options.port, useTls ? "(TLS)" : "");
			resolve(undefined);
		});

		server.on("error", (e: Error): void => {
			reject(e);
		});
	});
}

function startTcpServer(hub: Hub, options: TcpServerOptions): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		options = { ...options }; // clone
		options.port = options.port || DEFAULT_PORT_TCP;

		const server = net.createServer((socket: net.Socket) => {
			// tslint:disable-next-line:no-unused-expression
			new TcpConnection(hub, socket, "tcp" + connectionId++);
		});

		server.listen(
			{
				port: options.port,
				host: options.host,
				backlog: options.backlog,
			},
			(): void => {
				log.info("TCP Server started on port " + options.port);
				resolve(undefined);
			}
		);

		server.on("error", (e: Error): void => {
			reject(e);
		});
	});
}

function startTransports(hub: Hub, config: NormalizedConfig): Promise<void> {
	const serverOptions = Array.isArray(config.listen) ? config.listen : [config.listen];
	return Promise.all(
		serverOptions.map((options: ListenOptions) => {
			switch (options.type) {
				case "websocket":
					return startWebSocketServer(hub, <WSServerOptions>options);
				case "tcp":
					return startTcpServer(hub, <TcpServerOptions>options);
				default:
					throw new Error(`unsupported transport '${options!.type}'`);
			}
		})
	).return();
}

export class MServer {
	constructor(
		private hub: Hub,
		private normalizedConfig: NormalizedConfig
	) {
		this.setAuthenticator(normalizedConfig);
		this.setPermissions(normalizedConfig);
		this.instantiateNodes(normalizedConfig);
		this.setupBindings(normalizedConfig);
	}

	public init(): Promise<void> {
		return this.hub.init().then(() => {
			return startTransports(this.hub, this.normalizedConfig);
		}).catch((err: Error) => {
			throw new Error(`Failed to initialize:` + JSON.stringify(err, null, 2));
		});
	}

	private setAuthenticator({ users }: NormalizedConfig): void {
		const authenticator = new PlainAuthenticator();
		Object.keys(users).forEach((username: string) => {
			authenticator.setUser(username, users[username]);
		});
		this.hub.setAuthenticator(authenticator);
	}

	// Set up user permissions

	private setPermissions({ rights, users }: NormalizedConfig): void {
		if (rights === undefined && Object.keys(users).length === 0) {
			// Default rights: allow everyone to publish/subscribe.
			this.hub.setRights({
				"": {
					publish: true,
					subscribe: true,
				},
			});
		} else {
			try {
				this.hub.setRights(rights || {});
			} catch (err) {
				throw new Error("Invalid configuration: `rights` property: " + err.message);
			}
		}
	}

	// Instantiate nodes from config file

	private instantiateNodes({ nodes }: NormalizedConfig) {
		Object.keys(nodes).forEach((nodeName: string): void => {
			let def = nodes[nodeName];
			if (typeof def === "string") {
				def = <NodeDefinition>{
					type: def,
				};
			}
			const typeName = def.type;
			const nodeConstructor = nodeClassMap[typeName];
			if (!nodeConstructor) {
				throw new Error(`Unknown node type '${typeName}' for node '${nodeName}'`);
			}
			const node = new nodeConstructor(nodeName, def.options);
			this.hub.add(node);
		});
	}

	// Setup bindings between nodes

	private setupBindings({ bindings }: NormalizedConfig) {
		bindings.forEach((binding: Binding, index: number): void => {
			const from = this.hub.findSource(binding.from);
			if (!from) {
				throw new Error(`Unknown Source node '${binding.from}' in \`binding[${index}].from\``);
			}
			const to = this.hub.findDestination(binding.to);
			if (!to) {
				throw new Error(`Unknown Destination node '${binding.to}' in \`binding[${index}].to\``);
			}
			from.bind(to, binding.pattern);
		});
	}
}
