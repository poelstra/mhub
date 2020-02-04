/**
 * Connect an external client / transport through the MHub protocol to the
 * internal Hub.
 */

import * as events from "events";

import log from "./log";

import Dict from "./dict";
import Hub, { Authorizer } from "./hub";
import { getMatcher, MatchSpec } from "./match";
import Message from "./message";
import * as protocol from "./protocol";
import * as pubsub from "./pubsub";

type ResponseHandler = (response: protocol.Response) => void;

interface SubscriptionBinding {
	node: pubsub.Source;
	patterns: Dict<MatchSpec>;
}

class SubscriptionNode implements pubsub.Destination {
	public name: string;
	private _id: string;
	private _bindings: Dict<SubscriptionBinding> = new Dict();
	private _onResponse: ResponseHandler;

	constructor(conn: HubClient, id: string, onResponse: ResponseHandler) {
		this.name = conn.name + "_" + id;
		this._id = id;
		this._onResponse = onResponse;
	}

	public send(message: Message): void {
		log.debug("-> %s", this.name, message.topic);
		const response: protocol.MessageResponse = {
			type: "message",
			topic: message.topic,
			data: message.data,
			headers: message.headers,
			subscription: this._id,
		};
		this._onResponse(response);
	}

	public subscribe(node: pubsub.Source, pattern: string | undefined, matcher: MatchSpec): void {
		let bindings = this._bindings.get(node.name);
		if (!bindings) {
			bindings = {
				node,
				patterns: new Dict(),
			};
			this._bindings.set(node.name, bindings);
		}
		pattern = pattern || "";
		// Only bind if not already bound using this exact pattern
		if (!bindings.patterns.get(pattern)) {
			bindings.patterns.set(pattern, matcher);
			node.bind(this, matcher);
		}
	}

	public unsubscribe(node: pubsub.Source, pattern: string | undefined): void {
		const bindings = this._bindings.get(node.name);
		if (!bindings) {
			return;
		}
		pattern = pattern || "";
		const matcher = bindings.patterns.get(pattern);
		if (!matcher) {
			return;
		}
		bindings.patterns.remove(pattern);
		node.unbind(this, matcher);
	}

	public destroy(): void {
		this._bindings.forEach((binding): void => {
			binding.node.unbind(this);
		});
		this._bindings.clear();
	}
}

/**
 * Link of one client to the hub.
 * Every transport (tcp, websocket, etc.) and the LocalClient use this to
 * connect to the hub, passing it raw JSON objects received over the wire
 * to `processCommand()` and receiving responses from it by listing to
 * the `response` event.
 *
 * Events emitted from HubClient:
 * @event response(data: protocol.Response) Emitted whenever a response to
 *        a command, or new data to a subscription, is sent to this client.
 */
export class HubClient extends events.EventEmitter {
	public name: string; // TODO move this to higher layer?
	private _hub: Hub;
	private _subscriptions: Dict<SubscriptionNode> = new Dict<SubscriptionNode>();
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
		this._subscriptions.forEach((subscription) => subscription.destroy());
		this._subscriptions.clear();
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
				case "login":
					response = await this._handleLogin(msg);
					break;
				default:
					throw new Error(`unknown command '${msg!.type}'`);
			}
		} catch (e) {
			const errorMessage = String(e);
			if (errorMessage) {
				log.error(`[ ${this.name} ] error: ${errorMessage}`);
				response = {
					type: "error",
					message: errorMessage,
					seq: typeof msg === "object" ? msg.seq : undefined,
				};
			}
		}
		if (response) {
			this._onResponseHandler(response);
		}
	}

	private _handlePublish(msg: protocol.PublishCommand): protocol.PubAckResponse | undefined {
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

	private _handleSubscribe(msg: protocol.SubscribeCommand): protocol.SubAckResponse | undefined {
		// First check whether (un-)subscribing is allowed at all, to
		// prevent giving away info about (non-)existence of nodes.
		const authResult = this._authorizer.canSubscribe(msg.node, msg.pattern);
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
		let sub = this._subscriptions.get(id);
		if (!sub) {
			sub = new SubscriptionNode(this, id, this._onResponseHandler);
			this._subscriptions.set(id, sub);
		}

		// Create a matcher that filters both the subscription pattern and
		// authorization pattern(s), if needed.
		const patternMatcher = getMatcher(msg.pattern);
		let finalMatcher: (topic: string) => boolean;
		if (typeof authResult === "function") {
			finalMatcher = (topic) => authResult(topic) && patternMatcher(topic);
		} else {
			// authResult is true
			finalMatcher = patternMatcher;
		}
		sub.subscribe(node, msg.pattern, finalMatcher);

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "suback",
				seq: msg.seq,
			};
		}
	}

	private _handleUnsubscribe(msg: protocol.UnsubscribeCommand): protocol.UnsubAckResponse | undefined {
		// First check whether (un-)subscribing is allowed at all, to
		// prevent giving away info about (non-)existence of nodes.
		const authResult = this._authorizer.canSubscribe(msg.node, msg.pattern);
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
		const sub = this._subscriptions.get(id);
		if (sub) {
			sub.unsubscribe(node, msg.pattern);
		}

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

	private async _handleLogin(msg: protocol.LoginCommand): Promise<protocol.LoginAckResponse | undefined> {
		if (this._username !== undefined) {
			// Wouldn't really be a problem for now, but may be in
			// the future if e.g. different users have different quota
			// etc.
			throw new Error("already logged in");
		}

		const authenticated = await this._hub.authenticate(msg.username, msg.password);
		if (!authenticated) {
			throw new Error("authentication failed");
		}
		this.setUsername(msg.username);

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "loginack",
				seq: msg.seq,
			};
		}
	}

	private _onResponseHandler = (response: protocol.Response): void => {
		this.emit("response", response);
	};
}

export default HubClient;
