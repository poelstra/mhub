/**
 * Convert WebSocket into an MServer hub (i.e. a bunch of Nodes).
 */

"use strict";

import * as http from "http";
import * as events from "events";
import * as ws from "ws";
import * as assert from "assert";

import log from "./log";

import * as pubsub from "./pubsub";
import Message from "./message";

class SubscriptionNode implements pubsub.Destination {
	public conn: ClientConnection;
	public name: string;
	public id: string;
	public nodes: pubsub.Node[] = [];

	constructor(conn: ClientConnection, id: string) {
		this.conn = conn;
		this.name = this.conn.name + "_" + id;
		this.id = id;
	}

	public send(message: Message): void {
		log.write("-> %s", this.name, message.topic);
		let s = JSON.stringify({
			type: "message",
			topic: message.topic,
			data: message.data,
			headers: message.headers,
			subscription: this.id,
		});
		this.conn.send(s);
	}

	public bind(node: pubsub.Node, pattern?: string): void {
		if (this.nodes.indexOf(node) < 0) {
			this.nodes.push(node);
		}
		node.bind(this, pattern);
	}

	public destroy(): void {
		this.nodes.forEach((node: pubsub.Node): void => {
			node.unbind(this);
		});
		this.nodes = [];
	}
}

class ClientConnection extends events.EventEmitter {
	public hub: SocketHub;
	public socket: ws;
	public name: string;

	// tslint:disable-next-line:no-null-keyword
	private subscriptions: { [id: string]: SubscriptionNode; } = Object.create(null);

	constructor(hub: SocketHub, socket: ws, id: number) {
		super();
		this.hub = hub;
		this.socket = socket;
		this.name = "socket" + id; // TODO: Add IP address etc

		socket.on("close", this._handleClose.bind(this));
		socket.on("error", this._handleError.bind(this));
		socket.on("message", this._handleMessage.bind(this));

		log.write("[ %s ] connected", this.name);
	}

	public send(message: string): void {
		this.socket.send(message);
	}

	private _handleClose(): void {
		for (let id in this.subscriptions) { // tslint:disable-line:forin
			this.subscriptions[id].destroy();
		}
		// tslint:disable-next-line:no-null-keyword
		this.subscriptions = Object.create(null);
		this.emit("close");
		log.write("[ %s ] disconnected", this.name);
	}

	private _handleError(e: Error): void {
		log.write("[ %s ] error:", this.name, e);
		this.socket.close();
	}

	private _handleMessage(data: string): void {
		log.write("[ %s ] message", this.name, data);
		var response: { type: string; [header: string]: any; };
		try {
			var msg = JSON.parse(data);
			var node = this.hub.find(msg.node);
			if (!node) {
				log.write("[ %s ] error: unknown node '%s'", this.name, msg.node);
				response = {
					type: "error",
					message: "unknown node " + msg.node,
					seq: msg.seq,
				};
			} else if (msg.type === "publish") {
				node.send(new Message(msg.topic, msg.data, msg.headers));
				response = {
					type: "puback",
					seq: msg.seq,
				};
			} else if (msg.type === "subscribe") {
				let id = msg.id || "default";
				let sub = this.subscriptions[id];
				if (!sub) {
					sub = new SubscriptionNode(this, id);
					this.subscriptions[id] = sub;
				}
				sub.bind(node, msg.pattern);
				response = {
					type: "suback",
					seq: msg.seq,
				};
			}
		} catch (e) {
			log.write("[ %s ] decode error: ", this.name, e);
			response = {
				type: "error",
				message: "decode error " + e,
				seq: msg.seq,
			};
		}
		assert(response);
		this.socket.send(JSON.stringify(response));
	}
}

class SocketHub {
	// tslint:disable-next-line:no-null-keyword
	private nodes: { [name: string]: pubsub.Node } = Object.create(null);
	// tslint:disable-next-line:no-null-keyword
	private clients: { [index: number]: ClientConnection } = Object.create(null);
	private clientIndex: number = 0;

	constructor(server: http.Server, location: string = "/") {
		var wss = new ws.Server({ server: server, path: location });
		wss.on("connection", this._handleConnection.bind(this));
		wss.on("error", (e: Error): void => {
			console.log("WebSocketServer error:", e);
		});
	}

	public add(node: pubsub.Node): void {
		if (this.find(node.name)) {
			throw new Error("duplicate node: " + node.name);
		}
		this.nodes["_" + node.name] = node;
	}

	public find(nodeName: string): pubsub.Node {
		return this.nodes["_" + nodeName];
	}

	private _handleConnection(conn: ws): void {
		var id = this.clientIndex++;
		var dest = new ClientConnection(this, conn, id);
		this.clients[id] = dest;
		dest.on("close", (): void => {
			delete this.clients[id];
		});
	}
}

export default SocketHub;
