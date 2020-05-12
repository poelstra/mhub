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
import { swallowError, assertNever, deferred, Deferred } from "./util";

export const MAX_SEQ = 65536;

interface Transaction<T extends protocol.Response = protocol.Response> {
	promise: Promise<T>;
	resolve: (v: T | PromiseLike<T>) => void;
}

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

export interface SessionOptions {
	subscriptions?: string[];
}

/**
 * Interface for coupling of MHub client to transport protocol
 * such as a WebSocket or raw TCP stream.
 */
export interface Connection extends events.EventEmitter {
	/**
	 * Emitted when connection is closed by server.
	 *
	 * Ignored (but allowed) when closing due to close() or terminate()
	 * call, in which case the system waits until such calls to
	 * fulfill.
	 */
	// tslint:disable-next-line: unified-signatures
	on(event: "close", handler: () => void): this;

	/**
	 * Emitted when there was a connection or other low-level error
	 * about the connection/transport.
	 */
	on(event: "error", handler: (e: Error) => void): this;

	/**
	 * Emitted when a message (object) was received.
	 * Note: object needs to be deserialized already. Don't pass a string.
	 */
	on(event: "message", handler: (data: protocol.Response) => void): this;

	/**
	 * Start connection.
	 *
	 * @return Fulfilled promise once the connection can be used to transmit commands.
	 * If the promise is rejected, the connection is considered closed, and open()
	 * may be called again.
	 */
	open(): Promise<void>;

	/**
	 * Transmit data object.
	 * Will only be called when the connection is open.
	 *
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	send(data: protocol.Command): Promise<void>;

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed. All pending client transactions are already
	 * completed before calling close().
	 *
	 * Terminate will be called when close() fails.
	 *
	 * Will only be called when the connection is open.
	 *
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	close(): Promise<void>;

	/**
	 * Forcefully close connection.
	 *
	 * Can always be called, and should also e.g. abort a pending open().
	 * It can also be called while close() is still pending, and should
	 * make sure the close is handled as quickly as possible.
	 *
	 * If terminate fails, the connection is still considered closed.
	 *
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	terminate(): Promise<void>;
}

export interface BaseClient {
	/**
	 * Emitted when connection is established.
	 */
	on(event: "open", listener: () => void): this;

	/**
	 * Emitted when connection is closed.
	 */
	// tslint:disable-next-line: unified-signatures
	on(event: "close", listener: () => void): this;

	/**
	 * Emitted when there is an error on the connection that
	 * is not related to the execution of a specific command.
	 * (I.e. errors in response to commands are returned as
	 * promise rejections from these commands.)
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

enum ConnectionState {
	Disconnected,
	Connecting,
	Connected,
	Closing, // gracefully
	Terminating, // forcefully
}

/**
 * Base MHub client.
 *
 * Implements MHub client protocol, but does not implement the transport layer
 * such as WebSocket, raw TCP, etc.
 *
 * You'll typically derive a transport-specific class from this one.
 * @see NodeClient
 * @see MClient
 */
export class BaseClient extends events.EventEmitter {
	private _options: BaseClientOptions;
	private _transactions: {
		[seqNo: number]: Transaction;
	} = {};
	private _seqNo: number = 0;
	private _idleTimer: any = undefined;
	private _connection: Connection;
	private _connectionState: ConnectionState = ConnectionState.Disconnected;
	private _openEmitted: boolean = false;
	private _connecting: Promise<void> | undefined;
	private _closing: Promise<void> | undefined;
	private _terminated: Deferred<void> = deferred();

	/**
	 * Create new BaseClient.
	 * @param options Protocol settings
	 */
	constructor(connection: Connection, options?: BaseClientOptions) {
		super();

		// Ensure options is an object and fill in defaults
		options = { ...defaultBaseClientOptions, ...options };
		this._options = options;

		this._connection = connection;
		this._connection.on("error", (e: any): void => {
			this._handleConnectionError(e);
		});
		this._connection.on("close", (): void => {
			this._handleConnectionClose();
		});
		this._connection.on("message", (data: object): void => {
			this._handleSocketMessage(data);
		});

		this._terminated.promise.catch(swallowError);
	}

	/**
	 * Connect to the MServer.
	 * If connection is already active or pending, this is a no-op.
	 * Note: a connection is already initiated when the constructor is called.
	 */
	public async connect(): Promise<void> {
		switch (this._connectionState) {
			case ConnectionState.Connected:
				return;
			case ConnectionState.Closing:
			case ConnectionState.Terminating:
				await this.close();
				return this.connect();
			case ConnectionState.Disconnected:
				this._connecting = this._doConnect();
				return this._connecting;
			case ConnectionState.Connecting:
				return this._connecting;
			default:
				assertNever(this._connectionState);
		}
	}

	/**
	 * Gracefully disconnect from MHub server.
	 *
	 * Pending requests will be waited for, but new requests will
	 * be rejected.
	 *
	 * If already disconnected, this becomes a no-op.
	 *
	 * Note: any existing subscriptions will be lost.
	 */
	public async close(): Promise<void> {
		switch (this._connectionState) {
			case ConnectionState.Disconnected:
				return;
			case ConnectionState.Connected:
			case ConnectionState.Connecting:
				this._closing = this._doClose();
				return this._closing;
			case ConnectionState.Closing:
			case ConnectionState.Terminating:
				return this._closing;
			default:
				assertNever(this._connectionState);
		}
	}

	/**
	 * Forcefully disconnect from MHub server.
	 *
	 * Pending and new requests will be rejected with an error.
	 * If already disconnected, this becomes a no-op.
	 *
	 * Note: any existing subscriptions will be lost.
	 *
	 * Optionally pass an error to use for rejecting any pending
	 * requests.
	 *
	 * @param error (optional) Error to emit, reject transactions with, and
	 *              forcefully close connection.
	 */
	public async terminate(error?: Error): Promise<void> {
		switch (this._connectionState) {
			case ConnectionState.Disconnected:
				return;
			case ConnectionState.Connected:
			case ConnectionState.Connecting:
			case ConnectionState.Closing:
				this._closing = this._doTerminate(error);
				return this._closing;
			case ConnectionState.Terminating:
				return this._closing;
			default:
				assertNever(this._connectionState);
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
	public async login(username: string, password: string): Promise<void> {
		await this._send(<protocol.LoginCommand>{
			type: "login",
			username,
			password,
		});
	}

	public async session(
		name: string,
		sessionOptions?: SessionOptions
	): Promise<void> {
		await this._send(<protocol.SessionCommand>{
			type: "session",
			name,
			...sessionOptions,
		});
	}

	/**
	 * Try to create/reattach to server session, but don't fail if
	 * server doesn't support it.
	 *
	 * Note: this does throw an error for cases where sessions are supported
	 * on the server, but it's not possible to obtain one.
	 *
	 * @return true when session is attached to
	 */
	public async trySession(
		name: string,
		sessionOptions?: SessionOptions
	): Promise<boolean> {
		try {
			await this.session(name, sessionOptions);
			return true;
		} catch (err) {
			if (this._isUnsupportedCommandError(err)) {
				return false;
			}
			throw err;
		}
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
	public async subscribe(
		nodeName: string,
		pattern?: string,
		id?: string
	): Promise<void> {
		await this._send(<protocol.SubscribeCommand>{
			type: "subscribe",
			node: nodeName,
			pattern,
			id,
		});
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
	public async unsubscribe(
		nodeName: string,
		pattern?: string,
		id?: string
	): Promise<void> {
		await this._send(<protocol.UnsubscribeCommand>{
			type: "unsubscribe",
			node: nodeName,
			pattern,
			id,
		});
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
	public async publish(nodeName: string, ...args: any[]): Promise<void> {
		let message: Message;
		if (typeof args[0] === "object") {
			message = args[0];
		} else {
			message = new Message(args[0], args[1], args[2]);
		}
		message.validate();
		await this._send(<protocol.PublishCommand>{
			type: "publish",
			node: nodeName,
			topic: message.topic,
			data: message.data,
			headers: message.headers,
		});
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

	private async _doConnect(): Promise<void> {
		try {
			assert(this._connectionState === ConnectionState.Disconnected);
			this._connectionState = ConnectionState.Connecting;
			await Promise.race([
				this._connection.open(),
				this._terminated.promise, // ensure connect always returns when connection is aborted
			]);
			this._connectionState = ConnectionState.Connected;
			this._openEmitted = true;
			this._asyncEmit("open");
			this._restartIdleTimer();
		} finally {
			this._connecting = undefined;
		}
	}

	private async _doClose(): Promise<void> {
		assert(
			this._connectionState === ConnectionState.Connecting ||
				this._connectionState === ConnectionState.Connected
		);

		const forceClose = this._connectionState === ConnectionState.Connecting;
		this._connectionState = ConnectionState.Closing;

		try {
			if (forceClose) {
				// Forcefully close when not connected yet, otherwise we may
				// have to wait until the connect times out.
				await this._connection.terminate();
			} else {
				// Gracefully close in normal cases, meaning any
				// in-progress transactions will be completed first.
				const inProgress: Promise<any>[] = [];
				for (const t in this._transactions) {
					if (!this._transactions[t]) {
						continue;
					}
					// Keep waiting until all are done, even if some error out
					inProgress.push(
						this._transactions[t].promise.catch(swallowError)
					);
				}
				await Promise.race([
					Promise.all(inProgress),
					this._terminated.promise, // ensure close is aborted with a rejection when terminated
				]);
				await Promise.race([
					this._connection.close(),
					this._terminated.promise, // ensure close always returns when connection is aborted
				]);
			}
			this._closing = undefined;
			this._doDisconnected();
			this._triggerTerminated(new Error("connection closed"));
		} catch (err) {
			this.terminate(err).catch(swallowError);
			throw err;
		}
	}

	private async _doTerminate(error?: Error): Promise<void> {
		assert(
			this._connectionState === ConnectionState.Connecting ||
				this._connectionState === ConnectionState.Connected ||
				this._connectionState === ConnectionState.Closing
		);

		this._connectionState = ConnectionState.Terminating;
		if (error) {
			this._asyncEmit("error", error);
		}
		const transactionError = error ?? new Error("connection terminated");
		this._triggerTerminated(transactionError);
		this._abortTransactions(transactionError);
		try {
			await this._connection.terminate();
		} finally {
			this._closing = undefined;
			this._doDisconnected();
		}
	}

	private _triggerTerminated(error: Error): void {
		this._terminated.reject(error);
		this._terminated = deferred();
		this._terminated.promise.catch(swallowError);
	}

	private _abortTransactions(error: Error): void {
		for (const t in this._transactions) {
			if (!this._transactions[t]) {
				continue;
			}
			this._transactions[t].resolve(Promise.reject(error));
		}
		this._transactions = {};
	}

	private _doDisconnected(): void {
		assert(
			this._connectionState === ConnectionState.Closing ||
				this._connectionState === ConnectionState.Terminating
		);

		this._connectionState = ConnectionState.Disconnected;

		if (this._openEmitted) {
			this._openEmitted = false;
			// Emit `close` event when socket is closed (i.e. not just when
			// `close()` is called without being connected yet)
			this._asyncEmit("close");
		}

		this._stopIdleTimer();
	}

	private _handleConnectionError(err: any): void {
		if (!(err instanceof Error)) {
			err = new Error("connection error: " + err);
		}
		this.terminate(err);
	}

	private _handleConnectionClose(): void {
		switch (this._connectionState) {
			case ConnectionState.Disconnected:
				// Nothing to be done
				return;
			case ConnectionState.Closing:
			case ConnectionState.Terminating:
				// Let promise returned from the .close() or .terminate()
				// call be in the lead here
				return;
			case ConnectionState.Connecting:
			case ConnectionState.Connected:
				// Spontaneous close by server
				this._abortTransactions(new Error("connection closed"));
				this._connectionState = ConnectionState.Closing;
				this._doDisconnected();
				return;
			default:
				assertNever(this._connectionState);
		}
	}

	private _handleSocketMessage(data: object): void {
		assert(
			this._connectionState === ConnectionState.Connected ||
				this._connectionState === ConnectionState.Closing
		);
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
						// a specific request. There's no sane way to continue, so
						// terminate the connection
						this.terminate(err).catch(swallowError);
					}
					break;
				case "suback":
				case "unsuback":
				case "puback":
				case "loginack":
				case "sessionack":
				case "subscriptionack":
					const ackDec = <
						| protocol.PubAckResponse
						| protocol.SubAckResponse
						| protocol.UnsubAckResponse
						| protocol.LoginAckResponse
						| protocol.SessionAckResponse
						| protocol.SubscriptionAckResponse
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
					assertNever(
						response!.type,
						`unknown message type: ${response!.type}`
					);
			}
			this._restartIdleTimer();
		} catch (e) {
			this.terminate(
				new Error("message decode error: " + e.message)
			).catch(swallowError);
		}
	}

	/**
	 * (Re-)start idle timer and send pings when connection is idle
	 * for too long.
	 */
	private _restartIdleTimer(): void {
		this._stopIdleTimer();
		if (this._connectionState !== ConnectionState.Connected) {
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
		if (this._connectionState !== ConnectionState.Connected) {
			return;
		}
		this.ping(this._options.keepalive! - 1).catch((e) => {
			// Older MHub didn't support ping, so ignore this error.
			if (this._isUnsupportedCommandError(e)) {
				// We did send a request to the server, and the server did
				// send a response, so it's basically the same as receiving
				// a valid ping reply.
				return;
			}
			if (this._connectionState === ConnectionState.Connected) {
				// Only close (and emit an error) when we (seemed to be)
				// succesfully connected still (i.e. prevent multiple errors).
				this.terminate(e).catch(swallowError);
			}
		});
	}

	private async _send<R extends protocol.Response>(
		msg: protocol.Command
	): Promise<R> {
		if (this._connectionState !== ConnectionState.Connected) {
			throw new Error("not connected");
		}

		const seq = this._nextSeq();
		if (msg.type !== "ack") {
			msg.seq = seq;
		}
		let resolve: Transaction["resolve"];
		const promise = new Promise<protocol.Response>(
			(res) => (resolve = res)
		);
		this._transactions[seq] = {
			promise,
			resolve: resolve!,
		};
		this._restartIdleTimer();
		try {
			await this._connection.send(msg);
		} catch (err) {
			this._release(seq, err);
		}
		return promise as Promise<R>;
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
		const transaction = this._transactions[seqNr];
		if (!transaction) {
			return false;
		}
		delete this._transactions[seqNr];
		if (err) {
			transaction.resolve(Promise.reject(err));
		} else {
			assert(msg);
			transaction.resolve(msg!);
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
		assert(maxIteration > 0, "out of sequence numbers");
		const result = this._seqNo;
		this._seqNo = (this._seqNo + 1) % MAX_SEQ;
		return result;
	}

	/**
	 * Determine whether given error object indicates that the
	 * command is not supported.
	 * This is not entirely trivial for older server versions.
	 */
	private _isUnsupportedCommandError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			// Not even an error object, so definitely not a response
			// from the server.
			return false;
		}
		if (error.message.startsWith("unknown command")) {
			return true;
		}
		if (error.message === "server error: unknown node 'undefined'") {
			// For historic MHub protocol, all commands had to refer to a node,
			// so those servers will respond with an error that the node wasn't
			// specified.
			return true;
		}
		return false;
	}
}

export default BaseClient;
