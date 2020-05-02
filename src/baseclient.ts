/**
 * Base-class for any MHub client.
 *
 * Derived classes add actual transport logic to connect to
 * e.g. a Node.JS websocket API, a browser version, or a version
 * specifically for testing.
 */

import * as assert from "assert";
import * as events from "events";

import Message, { Headers } from "./message";
import { delay } from "./promise";
import * as protocol from "./protocol";

const MAX_SEQ = 65536;

type Resolver<T> = (v: T | PromiseLike<T>) => void;

/**
 * Options to be passed to constructor.
 */
export interface BaseClientOptions {
	/**
	 * Number of milliseconds of idleness (i.e. no data
	 * transmitted or received) before sending a ping to
	 * the server. If it doesn't respond within that same
	 * interval, the connection is closed with an error.
	 * Use 0 to disable.
	 */
	keepalive?: number;
}

export const defaultBaseClientOptions: BaseClientOptions = {
	keepalive: 30000, // milliseconds
};

/**
 * Interface for coupling of MHub client to transport protocol
 * such as a WebSocket or raw TCP stream.
 *
 * Events expected from the interface:
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(data: protocol.Response) Emitted when a message (object) was received.
 *            Note: object needs to be deserialized already. Don't pass a string.
 */
export interface Connection extends events.EventEmitter {
	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	send(data: protocol.Command): Promise<void>;

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	close(): Promise<void>;

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	terminate(): Promise<void>;
}

export interface BaseClient {
	/**
	 * Attach event handler for connection established event.
	 */
	on(event: "open", listener: () => void): this;
	/**
	 * Attache event handler for connection closed event.
	 */
	// tslint:disable-next-line: unified-signatures
	on(event: "close", listener: () => void): this;

	/**
	 * Attach event handler for error event.
	 */
	on(event: "error", listener: (error: Error) => void): this;

	/**
	 * Attach event handler for receiving a new message.
	 * If no explicit subscriptionId was passed during subscribe, string "default" is used.
	 */
	on(
		event: "message",
		listener: (message: Message, subscriptionId: string) => void
	): this;
}

/**
 * Abstract MHub client.
 *
 * Implements MHub client protocol, but does not implement the transport layer
 * such as WebSocket, raw TCP, etc.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message, subscriptionId: string) Emitted when message was received (due to subscription).
 */
export abstract class BaseClient extends events.EventEmitter {
	private _options: BaseClientOptions;
	private _socket: Connection | undefined;
	private _transactions: {
		[seqNo: number]: Resolver<protocol.Response>;
	} = {};
	private _seqNo: number = 0;
	private _idleTimer: any = undefined;
	private _connecting: Promise<void> | undefined;
	private _closing: Promise<void> | undefined;
	private _socketConstructor: () => Connection;
	private _connected: boolean = false; // Prevent emitting `close` when not connected

	/**
	 * Create new BaseClient.
	 * @param options Protocol settings
	 */
	constructor(
		socketConstructor: () => Connection,
		options?: BaseClientOptions
	) {
		super();

		// Ensure options is an object and fill in defaults
		options = { ...defaultBaseClientOptions, ...options };
		this._options = options;
		this._socketConstructor = socketConstructor;
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
		if (this._closing) {
			return this.close().then(() => this.connect());
		}

		if (!this._connecting) {
			this._connecting = new Promise<void>((resolve, reject) => {
				if (!this._socket) {
					const socketConstructor = this._socketConstructor;
					this._socket = socketConstructor(); // call it without a `this`
					this._socket.on("error", (e: any): void => {
						this._handleSocketError(e);
					});
					this._socket.on("open", (): void => {
						this._handleSocketOpen();
					});
					this._socket.on("close", (): void => {
						this._handleSocketClose();
					});
					this._socket.on("message", (data: object): void => {
						this._handleSocketMessage(data);
					});
				}

				this._socket.once("open", resolve);
				this._socket.once("error", reject);
			}).finally(() => {
				this._connecting = undefined;
			});
		}

		return this._connecting;
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
		if (!this._closing) {
			this._closing = new Promise<void>((resolve) => {
				// Announce error if necessary
				if (error) {
					this._asyncEmit("error", error);
				}

				// Abort pending transactions
				const transactionError =
					error || new Error("connection closed");
				for (const t in this._transactions) {
					if (!this._transactions[t]) {
						continue;
					}
					this._transactions[t](
						Promise.reject<protocol.Response>(transactionError)
					);
				}
				this._transactions = {};

				if (this._socket) {
					if (error || !this._connected) {
						// Forcefully close in case of an error, or when
						// not connected yet (otherwise we may have to wait
						// until the connect times out).
						return resolve(this._socket.terminate());
					} else {
						// Gracefully close in normal cases, meaning any
						// in-progress writes will be completed first.
						return resolve(this._socket.close());
					}
				} else {
					resolve(undefined);
				}
			}).finally(() => {
				this._socket = undefined;
				this._closing = undefined;
			});
		}

		return this._closing;
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
	 * Subscribe to a node.
	 *
	 * Emits the "message" event when a message is received for this subscription.
	 * First argument of that event is the message, second is the subscription id
	 * (or "default" if no id was given).
	 *
	 * @param nodeName Name of node in MServer to subscribe to (e.g. "default")
	 * @param pattern  Optional pattern glob (e.g. "/some/foo*"). Matches all topics if omitted.
	 * @param id       Optional subscription ID sent back with all matching messages
	 */
	public subscribe(
		nodeName: string,
		pattern?: string,
		id?: string
	): Promise<void> {
		return this._send(<protocol.SubscribeCommand>{
			type: "subscribe",
			node: nodeName,
			pattern,
			id,
		}).then(() => undefined);
	}

	/**
	 * Unsubscribe `pattern` (or all if omitted) from given `node` and `id`.
	 * Subscription id "default" is used if `id` is omitted.
	 *
	 * @param nodeName Name of node in MServer to unsubscribe from (e.g. "default")
	 * @param pattern  Optional pattern glob (e.g. "/some/foo*"). Unsubscribes all (on `node` and `id`)
	 *                 if omitted.
	 * @param id       Subscription ID, or "default"
	 */
	public unsubscribe(
		nodeName: string,
		pattern?: string,
		id?: string
	): Promise<void> {
		return this._send(<protocol.UnsubscribeCommand>{
			type: "unsubscribe",
			node: nodeName,
			pattern,
			id,
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
	public publish(
		nodeName: string,
		topic: string,
		data?: any,
		headers?: Headers
	): Promise<void>;
	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to (e.g. "default")
	 * @param message Message object
	 */
	public publish(nodeName: string, message: Message): Promise<void>;
	// Implementation
	public publish(nodeName: string, ...args: any[]): Promise<void> {
		let message: Message;
		if (typeof args[0] === "object") {
			message = args[0];
		} else {
			message = new Message(args[0], args[1], args[2]);
		}
		message.validate();
		return this._send(<protocol.PublishCommand>{
			type: "publish",
			node: nodeName,
			topic: message.topic,
			data: message.data,
			headers: message.headers,
		}).then(() => undefined);
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
		}).then(() => undefined);
		if (timeout) {
			return Promise.race([
				delay(timeout).then(() => {
					throw new Error("ping timeout");
				}),
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
		Promise.resolve().then(() => {
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

	private _handleSocketMessage(data: object): void {
		try {
			if (!data || typeof data !== "object") {
				throw new Error("missing or invalid data received");
			}
			const response = <protocol.Response>data;
			if (typeof response.type !== "string") {
				throw new Error("missing type property on received data");
			}
			switch (response.type) {
				case "message":
					const msgRes = <protocol.MessageResponse>response;
					const message = new Message(
						msgRes.topic,
						msgRes.data,
						msgRes.headers
					);
					message.validate();
					this._asyncEmit("message", message, msgRes.subscription);
					break;
				case "error":
					const errRes = <protocol.ErrorResponse>response;
					const err = new Error("server error: " + errRes.message);
					if (
						errRes.seq === undefined ||
						!this._release(errRes.seq, err, response)
					) {
						// Emit as a generic error when it could not be attributed to
						// a specific request
						this._asyncEmit("error", err);
					}
					break;
				case "suback":
				case "unsuback":
				case "puback":
				case "loginack":
					const ackDec = <
						| protocol.PubAckResponse
						| protocol.SubAckResponse
						| protocol.UnsubAckResponse
						| protocol.LoginAckResponse
					>response;
					if (protocol.hasSequenceNumber(ackDec)) {
						this._release(ackDec.seq, undefined, ackDec);
					}
					break;
				case "pingack":
					const pingDec = <protocol.PingAckResponse>response;
					if (protocol.hasSequenceNumber(pingDec)) {
						// ignore 'gratuitous' pings from the server
						this._release(pingDec.seq, undefined, pingDec);
					}
					break;
				default:
					throw new Error("unknown message type: " + response!.type);
			}
			this._restartIdleTimer();
		} catch (e) {
			this._asyncEmit(
				"error",
				new Error("message decode error: " + e.message)
			);
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
		if (
			typeof this._options.keepalive !== "number" ||
			this._options.keepalive <= 0
		) {
			return;
		}
		this._idleTimer = setTimeout(() => {
			this._idleTimer = undefined;
			this._handleIdleTimeout();
		}, this._options.keepalive);
	}

	private _stopIdleTimer(): void {
		if (this._idleTimer !== undefined) {
			clearTimeout(this._idleTimer);
			this._idleTimer = undefined;
		}
	}

	private _handleIdleTimeout(): void {
		if (!this._socket || !this._connected) {
			return;
		}
		this.ping(this._options.keepalive).catch((e) => {
			if (e && e.message === "server error: unknown node 'undefined'") {
				// Older MHub didn't support ping, so ignore this error.
				// (Additionally, all then-existing commands had to refer to a node.)
				// TCP machinery will terminate the connection if needed.
				// (Only doesn't work if this goes through proxies, and the
				// connection after that is dead.)
				return;
			}
			if (this._connected) {
				// Only close (and emit an error) when we (seemed to be)
				// succesfully connected (i.e. prevent multiple errors).
				this.close(e);
			}
		});
	}

	private _send(msg: protocol.Command): Promise<protocol.Response> {
		return new Promise<protocol.Response>((resolve, reject) => {
			const seq = this._nextSeq();
			msg.seq = seq;
			this._transactions[seq] = resolve;
			if (!this._socket || !this._connected) {
				throw new Error("not connected");
			}
			this._restartIdleTimer();
			this._socket.send(msg).catch((err: Error) => {
				if (err) {
					this._release(seq, err);
					return reject(err);
				}
			});
		});
	}

	/**
	 * Resolve pending transaction promise (either fulfill or reject with error).
	 * Returns true when the given sequence number was actually found.
	 */
	private _release(
		seqNr: number,
		err: Error | void,
		msg?: protocol.Response
	): boolean {
		const resolver = this._transactions[seqNr];
		if (!resolver) {
			return false;
		}
		delete this._transactions[seqNr];
		if (err) {
			resolver(Promise.reject<protocol.Response>(err));
		} else {
			resolver(msg!);
		}
		return true;
	}

	/**
	 * Compute next available sequence number.
	 * Throws an error when no sequence number is available (too many
	 * pending transactions).
	 */
	private _nextSeq(): number {
		let maxIteration = MAX_SEQ;
		while (--maxIteration > 0 && this._transactions[this._seqNo]) {
			this._seqNo = (this._seqNo + 1) % MAX_SEQ;
		}
		assert(maxIteration, "out of sequence numbers");
		const result = this._seqNo;
		this._seqNo = (this._seqNo + 1) % MAX_SEQ;
		return result;
	}
}

export default BaseClient;
