/**
 * Connect an external client / transport through the MHub protocol to the
 * internal Hub.
 */

import * as events from "events";

import log from "./log";

import Hub, { Permissions } from "./hub";
import * as protocol from "./protocol";
import * as pubsub from "./pubsub";
import Message from "./message";
import Dict from "./dict";
import { MatchSpec, getMatcher } from "./match";

type ResponseHandler = (response: protocol.Response) => void;

class SubscriptionNode implements pubsub.Destination {
	public name: string;
	private _conn: HubClient;
	private _id: string;
	private _nodes: pubsub.Source[] = [];
	private _onResponse: ResponseHandler;

	constructor(conn: HubClient, id: string, onResponse: ResponseHandler) {
		this._conn = conn;
		this.name = this._conn.name + "_" + id;
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

	public bind(node: pubsub.Source, pattern?: MatchSpec): void {
		if (this._nodes.indexOf(node) < 0) {
			this._nodes.push(node);
		}
		node.bind(this, pattern);
	}

	public destroy(): void {
		this._nodes.forEach((node: pubsub.Source): void => {
			node.unbind(this);
		});
		this._nodes = [];
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
	private _username: string;
	private _permissions: Permissions;

	constructor(hub: Hub, name: string) {
		super();
		this._hub = hub;
		this.name = name;
		this._permissions = this._hub.getUserPermissions(""); // permissions for anonymous user
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
		this._permissions = this._hub.getUserPermissions(this._username);
	}

	/**
	 * Validate and execute command against hub (e.g. login, publish,
	 * subscribe, etc.).
	 * Any response to the command (including errors) will be
	 * passed back using the `response` event.
	 *
	 * @param msg Command to process.
	 */
	public processCommand(msg: protocol.Command): void {
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
				case "ping":
					response = this._handlePing(msg);
					break;
				case "login":
					response = this._handleLogin(msg);
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
		const node = this._hub.find(msg.node);
		if (!node) {
			throw new Error(`unknown node '${msg.node}'`);
		}

		if (!this._permissions[msg.type]) {
			throw new Error("permission denied");
		}

		if (!pubsub.isDestination(node)) {
			throw new Error(`node '${msg.node}' is not a Destination`);
		}

		node.send(new Message(msg.topic, msg.data, msg.headers));

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "puback",
				seq: msg.seq,
			};
		}
	}

	private _handleSubscribe(msg: protocol.SubscribeCommand): protocol.SubAckResponse | undefined {
		const node = this._hub.find(msg.node);
		if (!node) {
			throw new Error(`unknown node '${msg.node}'`);
		}

		if (!this._permissions[msg.type]) {
			throw new Error("permission denied");
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
		sub.bind(node, msg.pattern);

		if (protocol.hasSequenceNumber(msg)) {
			return {
				type: "suback",
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

	private _handleLogin(msg: protocol.LoginCommand): protocol.LoginAckResponse | undefined {
		if (this._username !== undefined) {
			// Wouldn't really be a problem for now, but may be in
			// the future if e.g. different users have different quota
			// etc.
			throw new Error("already logged in");
		}

		const authenticated = this._hub.authenticate(msg.username, msg.password);
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
