/**
 * Convert WebSocket into an MServer hub (i.e. a bunch of Nodes).
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import http = require("http");
import events = require("events");
import ws = require("ws");

import d = require("./debug");
import debug = d.debug;

import pubsub = require("./pubsub");
import Message = require("./Message");

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

		debug.write("[ %s ] connected", this.name);
	}

	send(message: Message): void {
		debug.write("-> %s", this.name, message);
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
		debug.write("[ %s ] disconnected", this.name);
	}

	private _handleError(e: Error): void {
		debug.write("[ %s ] error", this.name, e);
		this.socket.close();
	}

	private _handleMessage(data: string): void {
		debug.write("[ %s ] message", this.name, data);
		try {
			var msg = JSON.parse(data);
			var node = this.hub.find(msg.node);
			if (!node) {
				debug.write("[ %s ] unknown node %s", this.name, msg.node);
				this.socket.send(JSON.stringify({
					type: "error",
					message: "unknown node " + msg.node
				}));
				return;
			}
			if (msg.type === "publish") {
				node.send(new Message(msg.topic, msg.data, msg.headers));
			} else if (msg.type === "subscribe") {
				if (this.subscriptions.indexOf(node) < 0) {
					this.subscriptions.push(node);
				}
				node.bind(this, msg.pattern);
			}
		} catch (e) {
			debug.write("[ %s ] decode error", this.name, e);
			this.socket.send(JSON.stringify({
				type: "error",
				message: "decode error " + e
			}));
		}
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

export = SocketHub;
