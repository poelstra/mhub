/**
 * MHub client library for Node.JS, using einaros/ws for WebSockets.
 */

import * as events from "events";
import * as tls from "tls";
import * as ws from "ws";

import { BaseClient, BaseClientOptions, Connection } from "./baseclient";
import * as protocol from "./protocol";
import { once } from "events";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;

/**
 * Options to be passed to NodeClient constructor.
 */
export interface NodeClientOptions extends BaseClientOptions, tls.TlsOptions {}

export const defaultClientOptions: NodeClientOptions = {};

class WebSocketConnection extends events.EventEmitter implements Connection {
	private _url: string;
	private _options: NodeClientOptions | undefined;
	private _socket: ws | undefined;
	private _connected: boolean = false;

	constructor(url: string, options?: NodeClientOptions) {
		super();
		this._url = url;
		this._options = options;
	}

	public async open(): Promise<void> {
		if (this._socket) {
			return;
		}
		this._socket = new ws(this._url, <any>this._options);
		this._socket.on("error", (e: any) => this.emit("error", e));
		this._socket.on("open", () => {
			this.emit("open");
			this._connected = true;
		});
		this._socket.on("close", () => {
			this._connected = false;
			this.emit("close");
			this._socket = undefined;
		});
		this._socket.on("message", (data: string) => {
			if (!data) {
				// Ignore empty 'lines'
				return;
			}
			const response = JSON.parse(data);
			this.emit("message", response);
		});
		await once(this._socket, "open");
	}

	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	public send(data: protocol.Command): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this._socket) {
				throw new Error("not connected");
			}
			this._socket.send(JSON.stringify(data), (err?: Error) => {
				if (err) {
					reject(err);
				} else {
					resolve(undefined);
				}
			});
		});
	}

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async close(): Promise<void> {
		if (!this._socket) {
			return;
		}
		try {
			const willEmitClose = this._connected;
			this._socket.close();
			if (willEmitClose) {
				await events.once(this._socket, "close");
			}
		} finally {
			this._socket = undefined;
		}
	}

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async terminate(): Promise<void> {
		if (!this._socket) {
			return;
		}
		try {
			const willEmitClose = this._connected;
			this._socket.terminate();
			if (willEmitClose) {
				await events.once(this._socket, "close");
			}
		} finally {
			this._socket = undefined;
		}
	}
}

/**
 * MHub client using server-side WebSocket.
 *
 * Allows subscribing and publishing to MHub server nodes.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message) Emitted when message was received (due to subscription).
 */
export class NodeClient extends BaseClient {
	private _url: string;

	/**
	 * Create new connection to MHub server.
	 * @param url Websocket URL of MHub server, e.g. ws://localhost:13900
	 * @param options Optional TLS settings and other options (see
	 *        https://nodejs.org/dist/latest-v6.x/docs/api/tls.html#tls_tls_connect_port_host_options_callback
	 *        for the TLS settings, and `NodeClientOptions` for other options)
	 */
	constructor(url: string, options?: NodeClientOptions) {
		// Ensure options is an object and fill in defaults
		options = { ...defaultClientOptions, ...options };

		// Prefix URL with "ws://" or "wss://" if needed
		if (url.indexOf("://") < 0) {
			if (options.key || options.pfx) {
				url = "wss://" + url;
			} else {
				url = "ws://" + url;
			}
		}
		// Append default port if necessary
		if (!url.match(":\\d+$")) {
			const useTls = url.indexOf("wss://") === 0;
			url = url + ":" + (useTls ? DEFAULT_PORT_WSS : DEFAULT_PORT_WS);
		}

		super(new WebSocketConnection(url, options), options);

		this._url = url;
	}

	/**
	 * Full URL of MHub connection.
	 */
	public get url(): string {
		return this._url;
	}
}

export default NodeClient;
