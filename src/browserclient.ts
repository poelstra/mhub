/**
 * MHub client library using native browser WebSocket.
 */

import * as events from "events";
import { BaseClient, BaseClientOptions, Connection } from "./baseclient";
import * as protocol from "./protocol";
import { once } from "events";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;

/**
 * Options to be passed to BrowserClient constructor.
 */
// tslint:disable-next-line:no-empty-interface
export interface BrowserClientOptions extends BaseClientOptions {}

export const defaultClientOptions: BrowserClientOptions = {};

const CLOSE_GOING_AWAY = 1001; // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Status_codes

class WebSocketConnection extends events.EventEmitter implements Connection {
	private _url: string;
	private _socket: WebSocket | undefined;

	constructor(url: string) {
		super();
		this._url = url;
	}

	public async open(): Promise<void> {
		if (this._socket) {
			return;
		}
		this._socket = new WebSocket(this._url);
		this._socket.addEventListener("error", (e: any) =>
			this.emit("error", e)
		);
		this._socket.addEventListener("open", () => {
			this.emit("open");
		});
		this._socket.addEventListener("close", () => {
			this.emit("close");
			this._socket = undefined;
		});
		this._socket.addEventListener("message", (event: MessageEvent) => {
			if (!event.data) {
				// Ignore empty 'lines'
				return;
			}
			const response = JSON.parse(event.data);
			this.emit("message", response);
		});
		await once(this._socket, "open");
	}

	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	public async send(data: protocol.Command): Promise<void> {
		if (!this._socket) {
			throw new Error("not connected");
		}
		this._socket.send(JSON.stringify(data));
	}

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async close(code?: number): Promise<void> {
		if (!this._socket) {
			return;
		}
		try {
			const willEmitClose =
				this._socket.readyState === WebSocket.CONNECTING ||
				this._socket.readyState === WebSocket.OPEN;
			this._socket.close(code);
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
	public terminate(): Promise<void> {
		return this.close(CLOSE_GOING_AWAY);
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
export class BrowserClient extends BaseClient {
	private _url: string;

	/**
	 * Create new connection to MServer.
	 * @param url Websocket URL of MServer, e.g. ws://localhost:13900
	 * @param options Optional options, see `BrowserClientOptions`.
	 */
	constructor(url: string, options?: BrowserClientOptions) {
		// Ensure options is an object and fill in defaults
		options = { ...defaultClientOptions, ...options };

		// Prefix URL with "ws://" if needed
		if (url.indexOf("://") < 0) {
			url = "ws://" + url;
		}
		// Append default port if necessary
		if (!url.match(":\\d+$")) {
			const useTls = url.indexOf("wss://") === 0;
			url = url + ":" + (useTls ? DEFAULT_PORT_WSS : DEFAULT_PORT_WS);
		}

		super(new WebSocketConnection(url), options);

		this._url = url;
	}

	/**
	 * Full URL of MHub connection.
	 */
	public get url(): string {
		return this._url;
	}
}

export default BrowserClient;
