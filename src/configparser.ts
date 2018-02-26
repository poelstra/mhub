import * as fs from "fs";
import * as path from "path";

import {
	Binding, Config, ListenOption, LoggingOptions,
	NodesConfig, NormalizedConfig, UserOptions
} from "./nodeserver";
import { replaceKeyFiles } from "./tls";

function normalizeListen(config: Config, configFile: string): ListenOption[] {
	// Checks
	if (config.port && config.listen) {
		throw new Error("Invalid configuration: specify either `port` or `listen`");
	}
	if (!(config.port || config.listen)) {
		throw new Error("Invalid configuration: `port` or `listen` missing");
	}

	let listen: ListenOption[] = [];
	// Normalize listen options, also handling port option
	if (config.port) {
		listen = [{
			type: "websocket",
			port: config.port,
		}];
	}
	if (config.listen) {
		listen = listen.concat(config.listen);
	}
	listen.forEach((listenOption: ListenOption) => {
		if (!listenOption.type) {
			// Default to WebSocket, for backward compatibility
			listenOption!.type = "websocket";
		}
		if (listenOption.type === "websocket") {
			// Read TLS key, cert, etc
			replaceKeyFiles(listenOption, path.dirname(configFile));
		}
	});
	return listen;
}

function normalizeUsers(config: Config, configFile: string): UserOptions {
	// Checks
	if (
		(config.users !== undefined) &&
		(typeof config.users !== "string") &&
		(typeof config.users !== "object")
	) {
		throw new Error(
			"Invalid configuration: `users` should be a filename or object containting username -> password pairs"
		);
	}

	// Initialize users
	let users: UserOptions = {};
	if (typeof config.users === "string") {
		const usersFile = path.resolve(path.dirname(configFile), config.users);
		try {
			users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
		} catch (e) {
			throw new Error(`Cannot parse users file '${usersFile}': ` + JSON.stringify(e, null, 2));
		}
	} else if (typeof config.users === "object") {
		users = config.users;
	}
	return users;
}

function normalizeBindings(config: Config): Binding[] {
	// Make bindings non optional
	return config.bindings || [];
}

function normalizeNodes(config: Config): NodesConfig {
	// Checks
	if (!config.nodes) {
		throw new Error("Invalid configuration: missing `nodes`");
	}
	if (!(Array.isArray(config.nodes) || typeof config.nodes === "object")) {
		throw new Error("Invalid configuration: `nodes` should be a NodeDefinition map, or an array of strings");
	}

	if (Array.isArray(config.nodes)) {
		// Backward compatibility, convert to new format
		return config.nodes.reduce((newNodes: NodesConfig, n: string) => {
			if (typeof n !== "string") {
				throw new Error("Invalid configuration: `nodes` is given as array, and must then contain only strings");
			}
			return {...newNodes, [n]: {type: "exchange"}};
		}, {});
	} else {
		return config.nodes;
	}
}

function normalizeStorage(config: Config): string {
	// defaults for storage
	return config.storage || "./storage";
}

// Historically, verbose logging was the default.
// Then, the config.verbose option was introduced, again kept as the default.
// Now, we have the config.logging option which is more flexible and is used
// whenever available.
// This can then be overriden using the commandline.
function normalizeLogging(config: Config): LoggingOptions {
	if (config.logging) {
		return config.logging;
	} else if (config.verbose === undefined || config.verbose) {
		return "debug";
	}
	return "info";
}

function readConfigFile(filePath: string): Config {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (e) {
		throw new Error(`Cannot parse config file '${filePath}':` + e.message);
	}
}

// 'Normalize' config and convert paths to their contents
export default function parseConfigFile(configFile: string): NormalizedConfig {
	const config = readConfigFile(configFile);
	return {
		listen: normalizeListen(config, configFile),
		users: normalizeUsers(config, configFile),
		bindings: normalizeBindings(config),
		nodes: normalizeNodes(config),
		storage: normalizeStorage(config),
		rights: config.rights,
		logging: normalizeLogging(config),
	};
}
