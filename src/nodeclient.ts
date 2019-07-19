/**
 * MHub client library for Node.JS, using einaros/ws for WebSockets.
 */

import * as events from "events";
import * as ws from "ws";

import { BaseClient, BaseClientOptions, Connection } from "./baseclient";
import * as protocol from "./protocol";
import { TlsOptions } from "./tls";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;

function noop(): void {
	/* no operation */
}

/**
 * Options to be passed to MClient constructor.
 */
export interface MClientOptions extends BaseClientOptions, TlsOptions {
	/**
	 * When true, will not automatically connect in the
	 * constructor. Connect explicitly using `#connect()`.
	 */
	noImplicitConnect?: boolean;
}

export const defaultClientOptions: MClientOptions = {
	noImplicitConnect: false,
};

class WebSocketConnection extends events.EventEmitter implements Connection {
	private _socket: ws;
	private _connected: boolean = false;

	constructor(url: string, options?: MClientOptions) {
		super();

		this._socket = new ws(url, <any>options);
		this._socket.on("error", (e: any) => this.emit("error", e));
		this._socket.on("open", () => {
			this.emit("open");
			this._connected = true;
		});
		this._socket.on("close", () => {
			this._connected = false;
			this.emit("close");
		});
		this._socket.on("message", (data: string) => {
			if (!data) {
				// Ignore empty 'lines'
				return;
			}
			const response = JSON.parse(data);
			this.emit("message", response);
		});
	}

	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	public send(data: protocol.Command): Promise<void> {
		return new Promise<void>((resolve, reject) => {
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
	public close(): Promise<void> {
		let result: Promise<void>;
		if (!this._connected) {
			result = Promise.resolve();
		} else {
			result = new Promise<void>((resolve) => {
				this._socket.once("close", resolve);
			});
		}
		this._socket.close();
		return result;
	}

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public terminate(): Promise<void> {
		let result: Promise<void>;
		if (!this._connected) {
			result = Promise.resolve();
		} else {
			result = new Promise<void>((resolve) => {
				this._socket.once("close", resolve);
			});
		}
		this._socket.terminate();
		return result;
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
export class MClient extends BaseClient {
	private _url: string;

	/**
	 * Create new connection to MServer.
	 * @param url Websocket URL of MServer, e.g. ws://localhost:13900
	 * @param options Optional TLS settings and other options (see
	 *        https://nodejs.org/dist/latest-v6.x/docs/api/tls.html#tls_tls_connect_port_host_options_callback
	 *        for the TLS settings, and `MClientOptions` for other options)
	 */
	constructor(url: string, options?: MClientOptions) {
		// Ensure options is an object and fill in defaults
		options = {...defaultClientOptions, ...options};

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

		super(
			() => new WebSocketConnection(url, options),
			options
		);

		this._url = url;

		if (!options.noImplicitConnect) {
			this.connect().catch(noop);
		}
	}

	/**
	 * Full URL of MHub connection.
	 */
	public get url(): string {
		return this._url;
	}
}

export default MClient;
