/**
 * MHub server (mserver)
 *
 * Makes MHub pubsub Nodes available through WebSockets.
 */

import "source-map-support/register";

import * as fs from "fs";
import * as path from "path";
import * as yargs from "yargs";

import Promise from "ts-promise";
import { PlainAuthenticator } from "./authenticator";
import Hub from "./hub";
import { LogLevel } from "./logger";
import { Binding, Config, ListenOptions, NodeDefinition,
	NodesConfig, NormalizedConfig, startTransports
} from "./nodeserver";
import * as pubsub from "./pubsub";
import * as storage from "./storage";
import { replaceKeyFiles } from "./tls";
import { KeyValues } from "./types";

import log from "./log";

// tslint:disable-next-line:no-shadowed-variable
function die(...args: any[]): void {
	log.fatal.apply(log, args);
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
	nodeClassMap[(<any>c).name] = c;
});

// For backward compatibility
/* tslint:disable:no-string-literal */
nodeClassMap["TopicQueue"] = TopicStore;
nodeClassMap["TopicState"] = TopicStore;
/* tslint:enable:no-string-literal */

// Build list of valid log level names (e.g. none, fatal, error, ...)
const logLevelNames = Object.keys(LogLevel).filter((s) => !/\d+/.test(s)).map((s) => s.toLowerCase());

// Parse input arguments

const args = yargs
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
	.option("l", {
		type: "string",
		alias: "loglevel",
		description: "Override log level in config file. Valid options: " + logLevelNames.join(", "),
	})
	.strict()
	.argv;

// Parse config file

let configFile: string;
if (!args.config) {
	configFile = path.resolve(__dirname, "../../server.conf.json");
} else {
	configFile = path.resolve(args.config);
}

function parseConfigFile(filePath: string): Config {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (e) {
		throw die(`Cannot parse config file '${filePath}':`, e);
	}
}

const config = parseConfigFile(configFile);

// Historically, verbose logging was the default.
// Then, the config.verbose option was introduced, again kept as the default.
// Now, we have the config.logging option which is more flexible and is used
// whenever available.
// This can then be overriden using the commandline.
function setLogLevel() {
	const logLevelName = args.loglevel || config.logging;
	if (config.logging) {
		// Convert config.logging to a LogLevel
		const matching = Object.keys(LogLevel).filter((s) => {
			return s.toLowerCase() === logLevelName;
		})[0];
		if (matching) {
			log.logLevel = (<any>LogLevel)[matching] as LogLevel;
		} else {
			die(`Invalid log level '${logLevelName}', expected one of: ${logLevelNames.join(", ")}`);
		}
	} else if (config.verbose === undefined || config.verbose) {
		log.logLevel = LogLevel.Debug;
	}
}

setLogLevel();

log.info("Using config file " + configFile);

// 'Normalize' config and convert paths to their contents
function normalizeConfig(looseConfig: Config): NormalizedConfig {
	if (!config.nodes) {
		throw new Error("Invalid configuration: missing `nodes`");
	}

	if (config.port) {
		if (config.listen) {
			throw new Error("Invalid configuration: specify either `port` or `listen`");
		}
		config.listen = {
			type: "websocket",
			port: config.port,
		};
		delete config.port;
	}
	if (!config.listen) {
		throw new Error("Invalid configuration: `port` or `listen` missing");
	}
	if (!Array.isArray(config.listen)) {
		config.listen = [config.listen];
	}
	config.listen.forEach((listen: ListenOptions) => {
		if (!listen.type) {
			// Default to WebSocket, for backward compatibility
			listen!.type = "websocket";
		}
		if (listen.type === "websocket") {
			// Read TLS key, cert, etc
			replaceKeyFiles(listen, path.dirname(configFile));
		}
	});

	// Initialize users
	if (typeof config.users === "string") {
		const usersFile = path.resolve(path.dirname(configFile), config.users);
		try {
			config.users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
		} catch (e) {
			throw new Error(`Cannot parse users file '${configFile}': ` + JSON.stringify(e, null, 2));
		}
	}
	if (config.users !== undefined && typeof config.users !== "object") {
		throw new Error(
			"Invalid configuration: `users` should be a filename or object containting username -> password pairs"
		);
	}

	if (!config.bindings) {
		config.bindings = [];
	}

	if (Array.isArray(config.nodes)) { // Backward compatibility, convert to new format
		const oldNodes = <string[]>config.nodes;
		const newNodes: NodesConfig = {};
		oldNodes.forEach((n: string) => {
			if (typeof n !== "string") {
				throw new Error("Invalid configuration: `nodes` is given as array, and must then contain only strings");
			}
			newNodes[n] = {
				type: "Exchange",
			};
		});
		config.nodes = newNodes;
	}

	if (typeof config.nodes !== "object") {
		throw new Error("Invalid configuration: `nodes` should be a NodeDefinition map, or an array of strings");
	}

	return <NormalizedConfig>config;
}

// Create default storage

function createDefaultStorage({ storage: storageConfig }: NormalizedConfig) {
	const storageRoot = path.resolve(path.dirname(configFile), storageConfig || "./storage");
	const simpleStorage = new storage.ThrottledStorage(new storage.SimpleFileStorage<any>(storageRoot));
	storage.setDefaultStorage(simpleStorage);
}

function setAuthenticator(hub: Hub, { users }: NormalizedConfig): void {
	const authenticator = new PlainAuthenticator();
	if (typeof users === "object") {
		Object.keys(users).forEach((username: string) => {
			authenticator.setUser(username, users[username]);
		});
	}
	hub.setAuthenticator(authenticator);
}

// Set up user permissions

function setPermissions(hub: Hub, { rights, users }: NormalizedConfig): void {
	if (rights === undefined && users === undefined) {
		// Default rights: allow everyone to publish/subscribe.
		hub.setRights({
			"": {
				publish: true,
				subscribe: true,
			},
		});
	} else {
		try {
			hub.setRights(rights || {});
		} catch (err) {
			throw new Error("Invalid configuration: `rights` property: " + err.message);
		}
	}
}

// Instantiate nodes from config file

function instantiateNodes(hub: Hub, { nodes }: NormalizedConfig) {
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
		hub.add(node);
	});
}

// Setup bindings between nodes

function setupBindings(hub: Hub, { bindings }: NormalizedConfig) {
	bindings.forEach((binding: Binding, index: number): void => {
		const from = hub.findSource(binding.from);
		if (!from) {
			throw new Error(`Unknown Source node '${binding.from}' in \`binding[${index}].from\``);
		}
		const to = hub.findDestination(binding.to);
		if (!to) {
			throw new Error(`Unknown Destination node '${binding.to}' in \`binding[${index}].to\``);
		}
		from.bind(to, binding.pattern);
	});
}

function main(): Promise<void> {
	const normalizedConfig = normalizeConfig(config);

	createDefaultStorage(normalizedConfig);

	// Create hub

	const hub = new Hub();

	setAuthenticator(hub, normalizedConfig);
	setPermissions(hub, normalizedConfig);
	instantiateNodes(hub, normalizedConfig);
	setupBindings(hub, normalizedConfig);

	return hub.init().then(() => startTransports(hub, normalizedConfig)).catch((err: Error) => {
		throw new Error(`Failed to initialize:` + JSON.stringify(err, null, 2));
	});
}

main().catch((err: Error) => {
	die(err);
});
