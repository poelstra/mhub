import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as ws from "ws";

import Promise from "ts-promise";
import Hub, { UserRights } from "./hub";
import { TlsOptions } from "./tls";
import TcpConnection from "./transports/tcpconnection";
import WSConnection from "./transports/wsconnection";

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
    listen: ListenOptions | ListenOptions[];
    verbose?: boolean;
    logging?: "none" | "fatal" | "error" | "warning" | "info" | "debug";
    bindings: Binding[];
    nodes: NodesConfig;
    storage?: string;
    users?: { [username: string]: string };
    rights: UserRights;
}

// Initialize and start server

let connectionId = 0;
function startWebSocketServer(hub: Hub, options: WSServerOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        options = { ...options }; // clone

        let server: http.Server | https.Server;
        const useTls = !!(options.key || options.pfx);

        options.port = options.port || (useTls ? DEFAULT_PORT_WS : DEFAULT_PORT_WSS);

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

export function startTransports(hub: Hub, config: NormalizedConfig): Promise<void> {
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
