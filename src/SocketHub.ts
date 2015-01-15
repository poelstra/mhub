/// <reference path="../typings/tsd.d.ts" />

"use strict";

import http = require("http");
import events = require("events");
import ws = require("ws");

import d = require("./debug");
import debug = d.debug;

import pubsub = require("./pubsub");

class SocketDestination extends events.EventEmitter implements pubsub.Destination {
	public hub: SocketHub;
	public socket: ws;
	public name: string;

	private subscriptions: { [name: string]: pubsub.Node } = Object.create(null);

	private static lastMessage: pubsub.Message;
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

	send(message: pubsub.Message): void {
		debug.write("-> %s", this.name, message);
		if (message !== SocketDestination.lastMessage) {
			SocketDestination.lastMessage = message;
			SocketDestination.lastJSON = JSON.stringify({
				type: "event",
				topic: message.topic,
				data: message.data,
				headers: message.headers
			});
		}
		this.socket.send(SocketDestination.lastJSON);
	}

	private _handleClose(): void {
		Object.keys(this.subscriptions).forEach((name: string): void => {
			this.subscriptions[name].unbind(this);
		});
		this.subscriptions = Object.create(null);
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
			if (msg.type === "publish") {
				if (this.hub.nodes[msg.node]) {
					this.hub.nodes[msg.node].send(new pubsub.Message(msg.topic, msg.data, msg.headers));
				}
			} else if (msg.type === "subscribe") {
				if (!this.subscriptions[msg.node] && this.hub.nodes[msg.node]) {
					this.hub.nodes[msg.node].bind(this);
					this.subscriptions[msg.node] = this.hub.nodes[msg.node];
				}
			}
		} catch (e) {
			debug.write("[ %s ] decode error", this.name, e);
			this.socket.close();
		}
	}
}

class SocketHub {
	public nodes: { [name: string]: pubsub.Node } = Object.create(null);

	private clients: { [index: number]: SocketDestination } = Object.create(null);
	private clientIndex: number = 0;

	constructor(server: http.Server, location: string = "/") {
		var wss = new ws.Server({ server: server, path: location });
		wss.on("connection", this._handleConnection.bind(this));
	}

	add(node: pubsub.Node): void {
		if (this.nodes[node.name]) {
			throw new Error("duplicate node: " + node.name);
		}
		this.nodes[node.name] = node;
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
