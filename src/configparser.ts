import * as fs from "fs";
import * as path from "path";

import {
    Config, ListenOptions,
    NodesConfig, NormalizedConfig
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

// 'Normalize' config and convert paths to their contents
export default function normalizeConfig(config: Config, configFile: string): NormalizedConfig {
    if (!config.nodes) {
        throw new Error("Invalid configuration: missing `nodes`");
    }

    config.listen = normalizeListen(config, configFile);

    // Initialize users
    if (typeof config.users === "string") {
        const usersFile = path.resolve(path.dirname(configFile), config.users);
        try {
            config.users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
        } catch (e) {
            throw new Error(`Cannot parse users file '${configFile}': ` + JSON.stringify(e, null, 2));
        }
    }
    if (config.users === undefined) {
        config.users = {};
    }
    if (typeof config.users !== "object") {
        throw new Error(
            "Invalid configuration: `users` should be a filename or object containting username -> password pairs"
        );
    }

    // Make bindings non optional
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

    // defaults for storage
    config.storage = config.storage || "./storage";

    return <NormalizedConfig>config;
}
