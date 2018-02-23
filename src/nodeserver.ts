
import { UserRights } from "./hub";
import { TlsOptions } from "./tls";

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
