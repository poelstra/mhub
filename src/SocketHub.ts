/**
 * Convert WebSocket into an MServer hub (i.e. a bunch of Nodes).
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import * as http from "http";
import * as events from "events";
import * as ws from "ws";
import * as assert from "assert";

import log from "./log";

import * as pubsub from "./pubsub";
import Message from "./Message";

class SocketDestination extends events.EventEmitter implements pubsub.Destination {
	public hub: SocketHub;
	public socket: ws;
	public name: string;

	private subscriptions: pubsub.Node[] = [];

	private static lastMessage: Message;
	private static lastJSON: string;

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

	send(message: Message): void {
		log.write("-> %s", this.name, message.topic);
		if (message !== SocketDestination.lastMessage) {
			SocketDestination.lastMessage = message;
			SocketDestination.lastJSON = JSON.stringify({
				type: "message",
				topic: message.topic,
				data: message.data,
				headers: message.headers
			});
		}
		this.socket.send(SocketDestination.lastJSON);
	}

	private _handleClose(): void {
		this.subscriptions.forEach((node: pubsub.Node): void => {
			node.unbind(this);
		});
		this.subscriptions = [];
		this.emit("close");
		log.write("[ %s ] disconnected", this.name);
	}

	private _handleError(e: Error): void {
		log.write("[ %s ] error", this.name, e);
		this.socket.close();
	}

	private _handleMessage(data: string): void {
		log.write("[ %s ] message", this.name, data);
		var response: { type: string; [header: string]: any; };
		try {
			var msg = JSON.parse(data);
			var node = this.hub.find(msg.node);
			if (!node) {
				log.write("[ %s ] unknown node %s", this.name, msg.node);
				response = {
					type: "error",
					message: "unknown node " + msg.node,
					seq: msg.seq
				};
			} else if (msg.type === "publish") {
				node.send(new Message(msg.topic, msg.data, msg.headers));
				response = {
					type: "puback",
					seq: msg.seq
				};
			} else if (msg.type === "subscribe") {
				if (this.subscriptions.indexOf(node) < 0) {
					this.subscriptions.push(node);
				}
				node.bind(this, msg.pattern);
				response = {
					type: "suback",
					seq: msg.seq
				};
			}
		} catch (e) {
			log.write("[ %s ] decode error", this.name, e);
			response = {
				type: "error",
				message: "decode error " + e,
				seq: msg.seq
			};
		}
		assert(response);
		this.socket.send(JSON.stringify(response));
	}
}

class SocketHub {
	private nodes: { [name: string]: pubsub.Node } = Object.create(null);
	private clients: { [index: number]: SocketDestination } = Object.create(null);
	private clientIndex: number = 0;

	constructor(server: http.Server, location: string = "/") {
		var wss = new ws.Server({ server: server, path: location });
		wss.on("connection", this._handleConnection.bind(this));
		wss.on("error", (e: Error): void => {
			console.log("WebSocketServer error:", e);
		});
	}

	add(node: pubsub.Node): void {
		if (this.find(node.name)) {
			throw new Error("duplicate node: " + node.name);
		}
		this.nodes["_" + node.name] = node;
	}

	find(nodeName: string): pubsub.Node {
		return this.nodes["_" + nodeName];
	}

	private _handleConnection(conn: ws): void {
		var id = this.clientIndex++;
		var dest = new SocketDestination(this, conn, id);
		this.clients[id] = dest;
		dest.on("close", (): void => {
			delete this.clients[id];
		});
	}
}

export default SocketHub;
