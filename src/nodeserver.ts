import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as tls from "tls";
import * as ws from "ws";

import { PlainAuthenticator } from "./authenticator";
import Hub, { UserRights } from "./hub";
import TcpConnection from "./transports/tcpconnection";
import WSConnection from "./transports/wsconnection";

import * as pubsub from "./pubsub";
import * as storage from "./storage";
import { KeyValues } from "./types";

import { Logger } from "./logger";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;
const DEFAULT_PORT_TCP = 13902;

export interface Binding {
	from: string;
	to: string;
	pattern?: string;
}

export interface WSServerOptions extends tls.TlsOptions {
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
	options?: { [key: string]: any };
}

export interface NodesConfig {
	[nodeName: string]: string | NodeDefinition;
}

export type ListenOption = WSServerOptions | TcpServerOptions;

export interface UserOptions {
	[username: string]: string;
}

export type LoggingOptions =
	| "none"
	| "fatal"
	| "error"
	| "warning"
	| "info"
	| "debug";

export interface Config {
	listen?: ListenOption | ListenOption[];
	port?: number;
	verbose?: boolean;
	logging?: LoggingOptions;
	bindings?: Binding[];
	nodes: string[] | NodesConfig;
	storage?: string;
	users?: string | UserOptions;
	rights?: UserRights;
}

export interface NormalizedConfig {
	listen: ListenOption[];
	logging: LoggingOptions;
	bindings: Binding[];
	nodes: NodesConfig;
	storage: string;
	users: UserOptions;
	rights: UserRights;
}

// Register known node types

import ConsoleDestination from "./nodes/consoleDestination";
import Exchange from "./nodes/exchange";
import HeaderStore from "./nodes/headerStore";
import PingResponder from "./nodes/pingResponder";
import Queue from "./nodes/queue";
import TestSource from "./nodes/testSource";
import TopicStore from "./nodes/topicStore";

type ConstructableNode = new (name: string, options?: KeyValues<any>) =>
	| pubsub.Source
	| pubsub.Destination;

const nodeClasses: ConstructableNode[] = [
	ConsoleDestination,
	Exchange,
	PingResponder,
	Queue,
	TestSource,
	TopicStore,
	HeaderStore,
];

const nodeClassMap: { [className: string]: ConstructableNode } = {};
nodeClasses.forEach((c) => {
	nodeClassMap[(<any>c).name] = c;
});

// For backward compatibility
nodeClassMap.TopicQueue = TopicStore;
nodeClassMap.TopicState = TopicStore;

export class MServer {
	private hub: Hub;
	private plainAuth: PlainAuthenticator;
	private normalizedConfig: NormalizedConfig;
	private logger: Logger | undefined = undefined;
	private connectionId = 0;
	constructor(normalizedConfig: NormalizedConfig, hub?: Hub) {
		this.plainAuth = new PlainAuthenticator();
		this.hub = hub || new Hub(this.plainAuth);
		this.normalizedConfig = normalizedConfig;
		this.setUsers(normalizedConfig);
		this.setPermissions(normalizedConfig);
		this.instantiateNodes(normalizedConfig);
		this.setupBindings(normalizedConfig);
		this.setStorage(normalizedConfig);
	}

	public init(): Promise<void> {
		return this.hub
			.init()
			.then(() => {
				return this.startTransports(this.hub, this.normalizedConfig);
			})
			.catch((err: Error) => {
				throw new Error(
					`Failed to initialize:` + JSON.stringify(err, null, 2)
				);
			});
	}

	public setLogger(logger: Logger): void {
		this.logger = logger;
	}

	private log(fmt: string, ...args: any[]): void {
		if (this.logger) {
			this.logger.info(fmt, ...args);
		}
	}

	private setUsers({ users }: NormalizedConfig): void {
		const usernames = Object.keys(users);
		usernames.forEach((username: string) => {
			this.plainAuth.setUser(username, users[username]);
		});
	}

	// Set up user permissions

	private setPermissions({ rights }: NormalizedConfig): void {
		try {
			this.hub.setRights(rights);
		} catch (err) {
			throw new Error(
				"Invalid configuration: `rights` property: " + err.message
			);
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
				throw new Error(
					`Unknown node type '${typeName}' for node '${nodeName}'`
				);
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
				throw new Error(
					`Unknown Source node '${binding.from}' in \`binding[${index}].from\``
				);
			}
			const to = this.hub.findDestination(binding.to);
			if (!to) {
				throw new Error(
					`Unknown Destination node '${binding.to}' in \`binding[${index}].to\``
				);
			}
			from.bind(to, binding.pattern);
		});
	}

	private setStorage({ storage: storageRoot }: NormalizedConfig) {
		if (typeof storageRoot !== "string") {
			throw new Error(`Invalid storage root, string expected`);
		}
		const simpleStorage = new storage.ThrottledStorage(
			new storage.SimpleFileStorage<any>(storageRoot)
		);
		this.hub.setStorage(simpleStorage);
	}

	// Initialize and start server
	private startWebSocketServer(
		hub: Hub,
		options: WSServerOptions
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			options = { ...options }; // clone

			let server: http.Server | https.Server;
			const useTls = !!(options.key || options.pfx);

			options.port =
				options.port || (useTls ? DEFAULT_PORT_WSS : DEFAULT_PORT_WS);

			if (useTls) {
				server = https.createServer(options);
			} else {
				server = http.createServer();
			}

			const wss = new ws.Server({ server: <any>server, path: "/" });
			wss.on("connection", (conn: ws) => {
				// tslint:disable-next-line:no-unused-expression
				new WSConnection(hub, conn, "websocket" + this.connectionId++);
			});

			wss.on("error", (e: Error): void => {
				reject(e);
			});

			server.listen(options.port, (): void => {
				this.log(
					`WebSocket Server started on port ${options.port}${
						useTls ? " (TLS)" : ""
					}`
				);
				resolve(undefined);
			});
		});
	}

	private startTcpServer(hub: Hub, options: TcpServerOptions): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			options = { ...options }; // clone
			options.port = options.port || DEFAULT_PORT_TCP;

			const server = net.createServer((socket: net.Socket) => {
				// tslint:disable-next-line:no-unused-expression
				new TcpConnection(hub, socket, "tcp" + this.connectionId++);
			});

			server.on("error", (e: Error): void => {
				reject(e);
			});

			server.listen(
				{
					port: options.port,
					host: options.host,
					backlog: options.backlog,
				},
				(): void => {
					this.log("TCP Server started on port " + options.port);
					resolve(undefined);
				}
			);
		});
	}

	private startTransports(hub: Hub, config: NormalizedConfig): Promise<void> {
		const serverOptions = Array.isArray(config.listen)
			? config.listen
			: [config.listen];
		return Promise.all(
			serverOptions.map((options: ListenOption) => {
				switch (options.type) {
					case "websocket":
						return this.startWebSocketServer(
							hub,
							<WSServerOptions>options
						);
					case "tcp":
						return this.startTcpServer(
							hub,
							<TcpServerOptions>options
						);
					default:
						throw new Error(
							`unsupported transport '${options!.type}'`
						);
				}
			})
		).then(() => undefined);
	}
}
