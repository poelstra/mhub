/**
 * Connect an external client / transport through the MHub protocol to the
 * internal Hub.
 */

"use strict";

import * as events from "events";

import log from "./log";

import Hub from "./hub";
import * as protocol from "./protocol";
import * as pubsub from "./pubsub";
import Message from "./message";
import Dict from "./dict";

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

	public bind(node: pubsub.Source, pattern?: string): void {
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

export class HubClient extends events.EventEmitter {
	public name: string; // TODO move this to higher layer?
	private _hub: Hub;
	private _subscriptions: Dict<SubscriptionNode> = new Dict<SubscriptionNode>();
	private _username: string;

	constructor(hub: Hub, name: string) {
		super();
		this._hub = hub;
		this.name = name;
	}

	public close(): void {
		this._subscriptions.forEach((subscription) => subscription.destroy());
		this._subscriptions.clear();
	}

	public setUsername(username: string): void {
		this._username = username;
	}

	public processCommand(msg: protocol.Command): void {
		let errorMessage: string;
		let response: protocol.Response;
		let haveSeq = false;
		let seq: number = undefined;
		try {
			haveSeq = typeof msg === "object" && typeof msg.seq === "number";
			seq = haveSeq ? msg.seq : undefined;

			if (msg.type === "publish" || msg.type === "subscribe") {
				const node = this._hub.find(msg.node);
				if (!node) {
					errorMessage = `unknown node '${msg.node}'`;
				} else if (msg.type === "publish") {
					const pubCmd = <protocol.PublishCommand>msg;
					if (!pubsub.isDestination(node)) {
						errorMessage = `node '${msg.node}' is not a Destination`;
					} else {
						node.send(new Message(pubCmd.topic, pubCmd.data, pubCmd.headers));
						if (haveSeq) {
							response = {
								type: "puback",
								seq: seq,
							};
						}
					}
				} else { // msg.type === "subscribe"
					const subCmd = <protocol.SubscribeCommand>msg;
					if (!pubsub.isSource(node)) {
						errorMessage = `node '${msg.node}' is not a Source`;
					} else {
						const id = subCmd.id || "default";
						let sub = this._subscriptions.get(id);
						if (!sub) {
							sub = new SubscriptionNode(this, id, this._onResponseHandler);
							this._subscriptions.set(id, sub);
						}
						sub.bind(node, subCmd.pattern);
						if (haveSeq) {
							response = {
								type: "suback",
								seq: seq,
							};
						}
					}
				}
			} else if (msg.type === "ping") {
				response = <protocol.PingAckResponse>{
					type: "pingack",
					seq: seq,
				};
			} else if (msg.type === "login") {
				if (this._username !== undefined) {
					// Wouldn't really be a problem for now, but may be in
					// the future if e.g. different users have different quota
					// etc.
					errorMessage = "already logged in";
				} else {
					const authenticated = this._hub.authenticate(msg.username, msg.password);
					if (!authenticated) {
						errorMessage = "authentication failed";
					} else {
						this.setUsername(msg.username);
						if (haveSeq) {
							response = <protocol.LoginAckResponse>{
								type: "loginack",
								seq: seq,
							};
						}
					}
				}
			} else {
				errorMessage = `unknown command '${msg!.type}'`;
			}
		} catch (e) {
			log.error("[ %s ] decode error: ", this.name, e);
			errorMessage = "decode error: " + String(e);
		}
		if (errorMessage) {
			log.error(`[ ${this.name} ] error: ${errorMessage}`);
			response = {
				type: "error",
				message: errorMessage,
				seq: seq,
			};
		}
		if (response) {
			this._onResponseHandler(response);
		}
	}

	private _onResponseHandler = (response: protocol.Response): void => {
		this.emit("response", response);
	};
}

export default HubClient;
