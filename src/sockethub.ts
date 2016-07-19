/**
 * Convert WebSocket into an MServer hub (i.e. a bunch of Nodes).
 */

"use strict";

import * as http from "http";
import * as https from "https";
import * as events from "events";
import * as ws from "ws";

import log from "./log";

import * as protocol from "./protocol";
import * as pubsub from "./pubsub";
import Message from "./message";

class SubscriptionNode implements pubsub.Destination {
	public conn: ClientConnection;
	public name: string;
	public id: string;
	public nodes: pubsub.Source[] = [];

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

	public bind(node: pubsub.Source, pattern?: string): void {
		if (this.nodes.indexOf(node) < 0) {
			this.nodes.push(node);
		}
		node.bind(this, pattern);
	}

	public destroy(): void {
		this.nodes.forEach((node: pubsub.Source): void => {
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
		let errorMessage: string;
		let response: { type: string; [header: string]: any; };
		let haveSeq = false;
		let seq: number = undefined;
		try {
			const msg: protocol.Command = JSON.parse(data);
			haveSeq = typeof msg === "object" && typeof msg.seq === "number";
			seq = haveSeq ? msg.seq : undefined;

			const node = this.hub.find(msg.node);
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
			} else if (msg.type === "subscribe") {
				const subCmd = <protocol.SubscribeCommand>msg;
				if (!pubsub.isSource(node)) {
					errorMessage = `node '${msg.node}' is not a Source`;
				} else {
					const id = subCmd.id || "default";
					let sub = this.subscriptions[id];
					if (!sub) {
						sub = new SubscriptionNode(this, id);
						this.subscriptions[id] = sub;
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
		} catch (e) {
			log.write("[ %s ] decode error: ", this.name, e);
			errorMessage = "decode error: " + String(e);
		}
		if (errorMessage) {
			log.write(`[ ${this.name} ] error: ${errorMessage}`);
			response = {
				type: "error",
				message: errorMessage,
				seq: seq,
			};
		}
		if (response) {
			this.socket.send(JSON.stringify(response));
		}
	}
}

class SocketHub {
	// tslint:disable-next-line:no-null-keyword
	private nodes: { [name: string]: pubsub.BaseNode } = Object.create(null);
	// tslint:disable-next-line:no-null-keyword
	private clients: { [index: number]: ClientConnection } = Object.create(null);
	private clientIndex: number = 0;

	constructor(server: http.Server | https.Server, location: string = "/") {
		var wss = new ws.Server({ server: <any>server, path: location });
		wss.on("connection", this._handleConnection.bind(this));
		wss.on("error", (e: Error): void => {
			console.log("WebSocketServer error:", e);
		});
	}

	public init(): Promise<void> {
		const initPromises: Promise<void>[] = [];
		for (const nodeName in this.nodes) { // tslint:disable-line:forin
			const node = this.nodes[nodeName];
			if (node.init) {
				initPromises.push(node.init());
			}
		}
		return Promise.all(initPromises).then(() => { /* nop */ });
	}

	public add(node: pubsub.BaseNode): void {
		if (this.find(node.name)) {
			throw new Error("duplicate node: " + node.name);
		}
		this.nodes["_" + node.name] = node;
	}

	public find(nodeName: string): pubsub.BaseNode {
		return this.nodes["_" + nodeName];
	}

	public findSource(nodeName: string): pubsub.Source {
		const n = this.nodes["_" + nodeName];
		return pubsub.isSource(n) ? n : undefined;
	}

	public findDestination(nodeName: string): pubsub.Destination {
		const n = this.nodes["_" + nodeName];
		return pubsub.isDestination(n) ? n : undefined;
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
