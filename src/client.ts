/**
 * MHub client library.
 */

"use strict";

import * as assert from "assert";
import * as events from "events";
import * as ws from "ws";
import Promise, { Thenable } from "ts-promise";
import * as assign from "object-assign";
import Message from "./message";
import { TlsOptions } from "./tls";
import * as protocol from "./protocol";

const DEFAULT_PORT_WS = 13900;
const DEFAULT_PORT_WSS = 13901;
const MAX_SEQ = 65536;

interface Resolver<T> {
	(v: T|Thenable<T>): void;
}

interface VoidResolver extends Resolver<void> {
	(v?: Thenable<void>): void;
}

/**
 * Options to be passed to MClient constructor.
 */
export interface MClientOptions extends TlsOptions {
	/**
	 * When true, will not automatically connect in the
	 * constructor. Connect explicitly using `#connect()`.
	 */
	noImplicitConnect?: boolean;

	/**
	 * Number of milliseconds of idleness (i.e. no data
	 * transmitted or received) before sending a ping to
	 * the server. If it doesn't respond within that same
	 * interval, the connection is closed with an error.
	 * Use 0 to disable.
	 */
	keepalive?: number;
}

export const defaultClientOptions: MClientOptions = {
	keepalive: 30000, // milliseconds
};

/**
 * MHub client.
 *
 * Allows subscribing and publishing to MHub server nodes.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message) Emitted when message was received (due to subscription).
 */
export class MClient extends events.EventEmitter {
	private _transactions: { [seqNo: number]: Resolver<protocol.Response> } = {};
	private _seqNo: number = 0;
	private _socket: ws = undefined;
	private _url: string;
	private _options: MClientOptions;
	private _idleTimer: any = undefined;
	private _connected: boolean = false; // Prevent emitting `close` when not connected

	/**
	 * Create new connection to MServer.
	 * @param url Websocket URL of MServer, e.g. ws://localhost:13900
	 * @param options Optional TLS settings and other options (see
	 *        https://nodejs.org/dist/latest-v6.x/docs/api/tls.html#tls_tls_connect_port_host_options_callback
	 *        for the TLS settings, and `MClientOptions` for other options)
	 */
	constructor(url: string, options?: MClientOptions) {
		super();

		// Ensure options is an object and fill in defaults
		options = assign({}, defaultClientOptions, options);

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
		this._url = url;
		this._options = options;
		if (!this._options.noImplicitConnect) {
			this.connect();
		}
	}

	/**
	 * Current Websocket, if any.
	 * @return {ws} Websocket or `undefined`
	 */
	public get socket(): ws {
		return this._socket;
	}

	public get url(): string {
		return this._url;
	}

	/**
	 * Connect to the MServer.
	 * If connection is already active or pending, this is a no-op.
	 * Note: a connection is already initiated when the constructor is called.
	 */
	public connect(): Promise<void> {
		if (this._connected) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			if (!this._socket) {
				this._socket = new ws(this._url, <any>this._options);
				this._socket.on("error", (e: any): void => { this._handleSocketError(e); });
				this._socket.on("open", (): void => { this._handleSocketOpen(); });
				this._socket.on("close", (): void => { this._handleSocketClose(); });
				this._socket.on("message", (data: string): void => { this._handleSocketMessage(data); });
			}

			this._socket.once("open", resolve);
			this._socket.once("error", reject);
		});
	}

	/**
	 * Disconnect from MServer.
	 * Pending requests will be rejected with an error.
	 * If already disconnected, this becomes a no-op.
	 *
	 * Note: any existing subscriptions will be lost.
	 *
	 * Optionally pass an error to signal abrupt failure,
	 * forcefully terminating the connection.
	 * The same error will be used to reject any pending
	 * requests.
	 * @param error (optional) Error to emit, reject transactions with, and
	 *              forcefully close connection.
	 */
	public close(error?: Error): Promise<void> {
		if (this._socket) {
			if (error) {
				this._socket.terminate();
			} else {
				this._socket.close();
			}
			this._socket = undefined;
		}
		if (error) {
			this._asyncEmit("error", error);
		}
		error = error || new Error("connection closed");
		const closedRejection = Promise.reject<never>(error);
		for (let t in this._transactions) {
			if (!this._transactions[t]) {
				continue;
			}
			this._transactions[t](closedRejection);
		}
		this._transactions = {};

		if (!this._connected) {
			return Promise.resolve();
		} else {
			return new Promise<void>((resolve) => {
				this.once("close", resolve);
			});
		}
	}

	/**
	 * Login to server using username/password.
	 *
	 * Warning: the username and password are sent in plain text.
	 * Only use this on secure connections such as wss://.
	 *
	 * @param username Username.
	 * @param password Password.
	 */
	public login(username: string, password: string): Promise<void> {
		return this._send(<protocol.LoginCommand>{
			type: "login",
			username,
			password,
		}).then(() => undefined);
	}

	/**
	 * Subscribe to a node. Emits the "message" event when a message is received for this
	 * subscription.
	 *
	 * @param nodeName Name of node in MServer to subscribe to (e.g. "default")
	 * @param pattern  Optional pattern glob (e.g. "namespace:*"), matches all messages if not given
	 * @param id       Optional subscription ID sent back with all matching messages
	 */
	public subscribe(nodeName: string, pattern?: string, id?: string): Promise<void> {
		return this._send(<protocol.SubscribeCommand>{
			type: "subscribe",
			node: nodeName,
			pattern: pattern,
			id: id,
		}).then(() => undefined);
	}

	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to (e.g. "default")
	 * @param topic Message topic
	 * @param data  Message data
	 * @param headers Message headers
	 */
	public publish(nodeName: string, topic: string, data?: any, headers?: { [name: string]: string }): Promise<void>;
	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to (e.g. "default")
	 * @param message Message object
	 */
	public publish(nodeName: string, message: Message): Promise<void>;
	// Implementation
	public publish(nodeName: string, ...args: any[]): Promise<void> {
		if (typeof args[0] === "object") {
			var message: Message = args[0];
			return this._send(<protocol.PublishCommand>{
				type: "publish",
				node: nodeName,
				topic: message.topic,
				data: message.data,
				headers: message.headers,
			}).then(() => undefined);
		} else {
			return this._send(<protocol.PublishCommand>{
				type: "publish",
				node: nodeName,
				topic: args[0],
				data: args[1],
				headers: args[2],
			}).then(() => undefined);
		}
	}

	/**
	 * Ping server.
	 * Mostly used to check whether connection is still alive.
	 * Note that the client will automatically send pings in the
	 * absence of other communication, so there should be no need to
	 * manually send pings.
	 *
	 * @param timeout (optional) Timeout in milliseconds before rejecting
	 *                the promise with an error, or infinite if not given.
	 */
	public ping(timeout?: number): Promise<void> {
		const pingResult = this._send(<protocol.PingCommand>{
			type: "ping",
		}).return();
		if (timeout) {
			return Promise.race([
				Promise.delay(timeout).throw(new Error("ping timeout")),
				pingResult,
			]);
		} else {
			return pingResult;
		}
	}

	/**
	 * Defer calling of events to next tick, to prevent e.g. errors
	 * in handlers from interfering with client state, and to
	 * prevent hard-to-debug async weirdness.
	 */
	private _asyncEmit(event: string, ...args: any[]): void {
		Promise.resolve().done(() => {
			this.emit(event, ...args);
		});
	}

	private _handleSocketOpen(): void {
		this._connected = true;
		this._asyncEmit("open");
		this._restartIdleTimer();
	}

	private _handleSocketError(err: any): void {
		if (!(err instanceof Error)) {
			err = new Error("WebSocket error: " + err);
		}
		this._asyncEmit("error", err);
	}

	private _handleSocketClose(): void {
		if (this._connected) {
			this._connected = false;
			// Emit `close` event when socket is closed (i.e. not just when
			// `close()` is called without being connected yet)
			this._asyncEmit("close");
		}
		// Discard socket, abort pending transactions
		this.close();
		this._stopIdleTimer();
	}

	private _handleSocketMessage(data: string): void {
		this._restartIdleTimer();
		if (data === "") {
			// Ignore empty lines
			return;
		}
		try {
			const decoded: protocol.Response = JSON.parse(data);
			switch (decoded.type) {
				case "message":
					const msgRes = <protocol.MessageResponse>decoded;
					this._asyncEmit(
						"message",
						new Message(msgRes.topic, msgRes.data, msgRes.headers),
						msgRes.subscription
					);
					break;
				case "error":
					const errRes = <protocol.ErrorResponse>decoded;
					const err = new Error("server error: " + errRes.message);
					if (errRes.seq === undefined || !this._release(errRes.seq, err, decoded)) {
						// Emit as a generic error when it could not be attributed to
						// a specific request
						this._asyncEmit("error", err);
					}
					break;
				case "suback":
				case "puback":
				case "loginack":
					const ackDec = <protocol.PubAckResponse | protocol.SubAckResponse | protocol.LoginAckResponse>decoded;
					this._release(ackDec.seq, undefined, ackDec);
					break;
				case "pingack":
					const pingDec = <protocol.PingAckResponse>decoded;
					if (pingDec.seq) { // ignore 'gratuitous' pings from the server
						this._release(pingDec.seq, undefined, pingDec);
					}
					break;
				default:
					throw new Error("unknown message type: " + decoded!.type);
			}
		} catch (e) {
			this._asyncEmit("error", new Error("message decode error: " + e.message));
		}
	}

	/**
	 * (Re-)start idle timer and send pings when connection is idle
	 * for too long.
	 */
	private _restartIdleTimer(): void {
		this._stopIdleTimer();
		if (!this._socket) {
			return;
		}
		if (typeof this._options.keepalive !== "number" || this._options.keepalive <= 0) {
			return;
		}
		this._idleTimer = setTimeout(
			() => { this._idleTimer = undefined; this._handleIdleTimeout(); },
			this._options.keepalive
		);
	}

	private _stopIdleTimer(): void {
		if (this._idleTimer !== undefined) {
			clearTimeout(this._idleTimer);
			this._idleTimer = undefined;
		}
	}

	private _handleIdleTimeout(): void {
		this.ping(this._options.keepalive)
			.catch((e) => {
				if (e && e.message === "server error: unknown node 'undefined'") {
					// Older MHub didn't support ping, so ignore this error.
					// (Additionally, all then-existing commands had to refer to a node.)
					// TCP machinery will terminate the connection if needed.
					// (Only doesn't work if this goes through proxies, and the
					// connection after that is dead.)
					return;
				}
				if (this._socket && this._socket.readyState === ws.OPEN) {
					// Only close (and emit an error) when we (seemed to be)
					// succesfully connected (i.e. prevent multiple errors).
					this.close(e);
				}
			});
	}

	private _send(msg: protocol.Command): Promise<protocol.Response> {
		return new Promise<protocol.Response>((resolve: () => void, reject: (err: Error) => void) => {
			msg.seq = this._nextSeq();
			this._transactions[msg.seq] = resolve;
			if (!this._socket) {
				throw new Error("not connected");
			}
			this._restartIdleTimer();
			this._socket.send(JSON.stringify(msg), (err?: Error) => {
				if (err) {
					this._release(msg.seq, err);
					return reject(err);
				}
			});
		});
	}

	/**
	 * Resolve pending transaction promise (either fulfill or reject with error).
	 * Returns true when the given sequence number was actually found.
	 */
	private _release(seqNr: number, err: Error|void, msg?: protocol.Response): boolean {
		let resolver = this._transactions[seqNr];
		if (!resolver) {
			return false;
		}
		delete this._transactions[seqNr];
		if (err) {
			resolver(Promise.reject<never>(err));
		} else {
			resolver(msg);
		}
		return true;
	}

	private _nextSeq(): number {
		let maxIteration = MAX_SEQ;
		while (--maxIteration > 0 && this._transactions[this._seqNo]) {
			this._seqNo = (this._seqNo + 1) % MAX_SEQ;
		}
		assert(maxIteration, "out of sequence numbers");
		let result = this._seqNo;
		this._seqNo = (this._seqNo + 1) % MAX_SEQ;
		return result;
	}
}

export default MClient;
