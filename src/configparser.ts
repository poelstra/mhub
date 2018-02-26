import * as fs from "fs";
import * as path from "path";

import {
    Binding, Config, ListenOptions,
    NodesConfig, NormalizedConfig, UserOptions
} from "./nodeserver";
import { replaceKeyFiles } from "./tls";

function normalizeListen(config: Config, configFile: string): ListenOptions[] {
    // Checks
    if (config.port && config.listen) {
        throw new Error("Invalid configuration: specify either `port` or `listen`");
    }
    if (!(config.port || config.listen)) {
        throw new Error("Invalid configuration: `port` or `listen` missing");
    }

    let listen: ListenOptions[] = [];
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
    listen.forEach((listenOption: ListenOptions) => {
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
            throw new Error(`Cannot parse users file '${configFile}': ` + JSON.stringify(e, null, 2));
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

// 'Normalize' config and convert paths to their contents
export default function normalizeConfig(config: Config, configFile: string): NormalizedConfig {
    config.listen = normalizeListen(config, configFile);
    config.users = normalizeUsers(config, configFile);
    config.bindings = normalizeBindings(config);
    config.nodes = normalizeNodes(config);
    config.storage = normalizeStorage(config);

    return <NormalizedConfig>config;
}
