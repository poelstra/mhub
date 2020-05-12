/**
 * Connect an external client / transport through the MHub protocol to the
 * internal Hub.
 */

import * as events from "events";

import log from "./log";

import Hub, { Authorizer } from "./hub";
import Message from "./message";
import * as protocol from "./protocol";
import * as pubsub from "./pubsub";
import { Session, SessionType, SubscriptionBindings } from "./session";
import { isStringOrStringArray, isStringArray } from "./util";
import { Matcher } from "./match";

export interface HubClient {
	/*
	 * Emitted whenever a response to a command, or new data to a subscription, is sent to
	 * this client.
	 */
	on(event: "response", handler: (response: protocol.Response) => void): this;

	/**
	 * Emitted when client experienced an error.
	 */
	on(event: "error", handler: (error: Error) => void): this;
}

/**
 * Link of one client to the hub.
 * Every transport (tcp, websocket, etc.) and the LocalClient use this to
 * connect to the hub, passing it raw JSON objects received over the wire
 * to `processCommand()` and receiving responses from it by listing to
 * the `response` event.
 */
export class HubClient extends events.EventEmitter {
	public name: string; // TODO move this to higher layer?
	private _session: Session | undefined;
	private _hub: Hub;
	private _username: string | undefined;
	private _authorizer: Authorizer;

	constructor(hub: Hub, name: string) {
		super();
		this._hub = hub;
		this.name = name;
		this._authorizer = this._hub.getAuthorizer(""); // permissions for anonymous user
	}

	/**
	 * Disconnect from Hub.
	 */
	public close(): void {
		this._session?.detach();
	}

	/**
	 * Set username.
	 * The MHub protocol provides a login command, which can be used
	 * to allow authentication across transports that otherwise don't
	 * natively support it (e.g. raw tcp).
	 * Some transports may deduce the authentication user using other
	 * means (e.g. in SSL client certificate).
	 *
	 * Note: using this will make a subsequent login command fail.
	 *
	 * @param username Username to assume.
	 */
	public setUsername(username: string): void {
		this._username = username;
		this._authorizer = this._hub.getAuthorizer(this._username);
	}

	/**
	 * Validate and execute command against hub (e.g. login, publish,
	 * subscribe, etc.).
	 * Any response to the command (including errors) will be
	 * passed back using the `response` event.
	 *
	 * @param msg Command to process.
	 */
	public async processCommand(msg: protocol.Command): Promise<void> {
		let response: protocol.Response | undefined;
		try {
			if (typeof msg !== "object") {
				throw new Error("invalid message, object expected");
			}
			if (typeof msg.type !== "string") {
				throw new Error("invalid message, missing or invalid type");
			}
			switch (msg.type) {
				case "ack":
					this._handleAck(msg);
					break;
				case "publish":
					response = this._handlePublish(msg);
					break;
				case "subscribe":
					response = this._handleSubscribe(msg);
					break;
				case "unsubscribe":
					response = this._handleUnsubscribe(msg);
					break;
				case "ping":
					response = this._handlePing(msg);
					break;
				case "session":
					response = this._handleSession(msg);
					break;
				case "subscription":
					response = this._handleSubscription(msg);
					break;
				case "login":
					response = await this._handleLogin(msg);
					break;
				default:
					const checkNever: never = msg!.type;
					throw new Error(`unknown command '${checkNever}'`);
			}
		} catch (e) {
			const errorMessage = String(e);
			if (errorMessage) {
				log.error(`[ ${this.name} ] error: ${errorMessage}`);
				response = {
					type: "error",
					message: errorMessage,
					// Note: msg can be anything here, even undefined
					seq: typeof msg === "object" ? (msg as any).seq : undefined,
				};
			}
		}
		if (response) {
			this.emit("response", response);
		}
	}

	private _handlePublish(
		msg: protocol.PublishCommand
	): protocol.PubAckResponse | undefined {
		// topic and headers are checked by message.validate() below
		if (typeof msg.node !== "string") {
			throw new Error(`invalid node '${msg.node}': string expected`);
		}

		if (!this._authorizer.canPublish(msg.node, msg.topic)) {
			throw new Error("permission denied");
		}

		const node = this._hub.find(msg.node);
		if (!node) {
			throw new Error(`unknown node '${msg.node}'`);
		}

		if (!pubsub.isDestination(node)) {
			throw new Error(`node '${msg.node}' is not a Destination`);
		}

		const message = new Message(msg.topic, msg.data, msg.headers);
		message.validate();
		node.send(message);

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "puback",
				seq: msg.seq,
			};
		}
	}

	private _handleSubscribe(
		msg: protocol.SubscribeCommand
	): protocol.SubAckResponse | undefined {
		if (typeof msg.node !== "string") {
			throw new Error(`invalid node '${msg.node}': string expected`);
		}
		if (typeof msg.pattern !== "string" && msg.pattern !== undefined) {
			throw new Error(
				`invalid pattern '${msg.pattern}': string or undefined expected`
			);
		}

		// First check whether (un-)subscribing is allowed at all, to
		// prevent giving away info about (non-)existence of nodes.
		const authMatcher = this._authorizer.getSubscribeMatcher(msg.node);
		if (!authMatcher) {
			throw new Error("permission denied");
		}

		const node = this._hub.find(msg.node);
		if (!node) {
			throw new Error(`unknown node '${msg.node}'`);
		}

		if (!pubsub.isSource(node)) {
			throw new Error(`node '${msg.node}' is not a Source`);
		}

		const id = msg.id || "default";
		const session = this._getOrCreateSession();
		const sub = session.getOrCreateSubscription(id);
		sub.subscribe(node, msg.pattern ?? "", authMatcher);

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "suback",
				seq: msg.seq,
			};
		}
	}

	private _handleUnsubscribe(
		msg: protocol.UnsubscribeCommand
	): protocol.UnsubAckResponse | undefined {
		if (typeof msg.node !== "string") {
			throw new Error(`invalid node '${msg.node}': string expected`);
		}
		if (typeof msg.pattern !== "string" && msg.pattern !== undefined) {
			throw new Error(
				`invalid pattern '${msg.pattern}': string or undefined expected`
			);
		}

		// First check whether (un-)subscribing is allowed at all, to
		// prevent giving away info about (non-)existence of nodes.
		const authResult = this._authorizer.getSubscribeMatcher(msg.node);
		if (!authResult) {
			throw new Error("permission denied");
		}

		const node = this._hub.find(msg.node);
		if (!node) {
			throw new Error(`unknown node '${msg.node}'`);
		}

		if (!pubsub.isSource(node)) {
			throw new Error(`node '${msg.node}' is not a Source`);
		}

		const id = msg.id || "default";
		const session = this._getOrCreateSession();
		const sub = session.getOrCreateSubscription(id);
		sub.unsubscribe(node, msg.pattern ?? "");

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "unsuback",
				seq: msg.seq,
			};
		}
	}

	private _handlePing(msg: protocol.PingCommand): protocol.PingAckResponse {
		return {
			type: "pingack",
			seq: msg.seq,
		};
	}

	private async _handleLogin(
		msg: protocol.LoginCommand
	): Promise<protocol.LoginAckResponse | undefined> {
		if (typeof msg.username !== "string") {
			throw new Error(
				`invalid username '${msg.username}': string expected`
			);
		}
		if (typeof msg.password !== "string") {
			throw new Error(
				`invalid password '${msg.password}': string expected`
			);
		}

		if (this._username !== undefined) {
			// Wouldn't really be a problem for now, but may be in
			// the future if e.g. different users have different quota
			// etc.
			throw new Error("already logged in");
		}

		const authenticated = await this._hub.authenticate(
			msg.username,
			msg.password
		);
		if (!authenticated) {
			throw new Error("authentication failed");
		}
		this.setUsername(msg.username);

		log.info(`[ ${this.name} ] logged in as ${msg.username}`);

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "loginack",
				seq: msg.seq,
			};
		}
	}

	private _handleSession(
		msg: protocol.SessionCommand
	): protocol.SessionAckResponse {
		if (typeof msg.name !== "string") {
			throw new Error(`missing or invalid session name '${msg.name}'`);
		}
		if (
			msg.subscriptions !== undefined &&
			!isStringArray(msg.subscriptions)
		) {
			throw new Error(
				`invalid subscriptions '${msg.subscriptions}', undefined or string array expected`
			);
		}
		if (this._session) {
			// TODO allow re-attaching to the same session? Could be useful for stuff
			// like Arduino connected over a serial link, that doesn't really have the
			// concept of a connection, but does need to be able to 'reconnect'.
			throw new Error("already have a session");
		}
		if (!this._username) {
			throw new Error("cannot obtain session, not logged in");
		}
		let session = this._hub.findSession(this._username, msg.name);
		if (!session) {
			session = new Session(
				`${this.name}-${this._username}-${msg.name}`,
				SessionType.Memory
			);
		}
		if (msg.subscriptions) {
			session.setSubscriptions(msg.subscriptions);
		}
		this._attachSession(session);
		return {
			type: "sessionack",
			seq: msg.seq,
		};
	}

	private _handleSubscription(
		msg: protocol.SubscriptionCommand
	): protocol.SubscriptionAckResponse | undefined {
		if (typeof msg.id !== "string") {
			throw new Error(`invalid id '${msg.id}', string expected`);
		}
		if (msg.bindings !== undefined && typeof msg.bindings !== "object") {
			throw new Error(
				`invalid bindings '${msg.bindings}', undefined or object expected`
			);
		}

		let authMatchers: Map<pubsub.Source, Matcher> | undefined;
		let subBindings: SubscriptionBindings | undefined;
		if (msg.bindings) {
			authMatchers = new Map();
			subBindings = new Map();
			for (const nodeName of Object.keys(msg.bindings)) {
				// First check whether (un-)subscribing is allowed at all, to
				// prevent giving away info about (non-)existence of nodes.
				const authMatcher = this._authorizer.getSubscribeMatcher(
					nodeName
				);
				if (!authMatcher) {
					throw new Error("permission denied");
				}

				const node = this._hub.find(nodeName);
				if (!node) {
					throw new Error(`unknown node '${nodeName}'`);
				}

				if (!pubsub.isSource(node)) {
					throw new Error(`node '${nodeName}' is not a Source`);
				}

				const patterns = msg.bindings[nodeName];
				const type = typeof patterns;
				if (type !== "boolean" && !isStringOrStringArray(patterns)) {
					throw new Error(
						`invalid patterns for node '${nodeName}': '${patterns}', boolean or string or string array expected`
					);
				}

				authMatchers.set(node, authMatcher);
				subBindings.set(node, patterns);
			}
		}

		const session = this._getSession();
		const sub = session.getSubscription(msg.id);

		if (subBindings && authMatchers) {
			sub.setBindings(subBindings, authMatchers);
		}

		if (!protocol.hasSequenceNumber(msg)) {
			return;
		}

		let bindings: protocol.Bindings | undefined;
		if (!msg.bindings) {
			bindings = {};
			for (const [source, patterns] of sub.getBindings()) {
				bindings[source.name] = patterns;
			}
		}

		return {
			type: "subscriptionack",
			lastAck: sub.first,
			bindings,
			seq: msg.seq,
		};
	}

	private _handleAck(msg: protocol.AckCommand): void {
		if (typeof msg.id !== "string") {
			throw new Error(`invalid id '${msg.id}', string expected`);
		}
		if (typeof msg.ack !== "number") {
			throw new Error(`invalid ack '${msg.ack}', number expected`);
		}
		if (msg.window !== undefined && typeof msg.window !== "number") {
			throw new Error(
				`invalid window '${msg.window}', undefined or number expected`
			);
		}
		this._getSession().getSubscription(msg.id).ack(msg.ack, msg.window);
	}

	private _getSession(): Session {
		if (!this._session) {
			throw new Error("no session");
		}
		return this._session;
	}

	private _getOrCreateSession(): Session {
		if (!this._session) {
			const session = new Session(
				`${this.name}-<auto>`,
				SessionType.Volatile
			);
			this._attachSession(session);
		}
		return this._session!;
	}

	private _attachSession(session: Session): void {
		if (this._session) {
			// TODO allow re-attaching to the same session? Could be useful for stuff
			// like Arduino connected over a serial link, that doesn't really have the
			// concept of a connection, but does need to be able to 'reconnect'.
			throw new Error("already have a session");
		}
		this._session = session;
		this._session.attach({
			detach: () => {
				// TODO dedicated protocol response for this? Or at least use ErrorCode
				this.emit("message", {
					type: "error",
					message: "session detached",
				} as protocol.ErrorResponse);
			},
			message: (message, id, seq) => {
				this.emit("response", {
					type: "message",
					topic: message.topic,
					data: message.data,
					headers: message.headers,
					subscription: id,
					seq,
				} as protocol.MessageResponse);
			},
		});
	}
}

export default HubClient;
