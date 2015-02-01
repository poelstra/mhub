/**
 * FLL Message Server client.
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import events = require("events");
import ws = require("ws");
import Message = require("./Message");

/**
 * FLL Message Server client.
 *
 * Allows subscribing and publishing to MServer nodes.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message) Emitted when message was received (due to subscription).
 */
class MClient extends events.EventEmitter {
	url: string;
	socket: ws = null;

	/**
	 * Create new connection to MServer.
	 * @param url Websocket URL of MServer, e.g. ws://localhost:13900
	 */
	constructor(url: string) {
		super();
		this.url = url;
		this.connect();
	}

	/**
	 * (Re-)connect to MServer.
	 *
	 * Note: any existing subscriptions will be lost.
	 */
	connect(): void {
		this.socket = new ws(this.url);
		this.socket.on("error", (e: any): void => {
			if (!(e instanceof Error)) {
				e = new Error("WebSocket error: " + e);
			}
			this.emit("error", e);
		});
		this.socket.on("open", (): void => { this.emit("open"); });
		this.socket.on("close", (): void => { this.emit("close"); });
		this.socket.on("message", (data: string): void => {
			try {
				var decoded = JSON.parse(data);
				switch (decoded.type) {
					case "message":
						this.emit("message", new Message(decoded.topic, decoded.data, decoded.headers));
						break;
					case "error":
						this.emit("error", new Error("server error: " + decoded.message));
						break;
					default:
						throw new Error("unknown message type: " + decoded.type);
				}
			} catch (e) {
				this.emit("error", new Error("message decode error: " + e.message));
			}
		});
	}

	/**
	 * Disconnect from MServer.
	 */
	close(): void {
		this.socket.close();
	}

	/**
	 * Subscribe to a node. Emits the "message" event when a message is received for this
	 * subscription.
	 *
	 * @param nodeName Name of node in MServer to subscribe to
	 * @param pattern  Optional pattern glob (e.g. "namespace:*"), matches all messages if not given
	 */
	subscribe(nodeName: string, pattern?: string): void {
		this.socket.send(JSON.stringify({
			type: "subscribe",
			node: nodeName,
			pattern: pattern
		}));
	}

	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to
	 * @param topic Message topic
	 * @param data  Message data
	 * @param headers Message headers
	 * @param callback Function to call when message is written to server (note: does not guarantee that e.g. nodeName actually exists)
	 */
	publish(nodeName: string, topic: string, data?: any, headers?: { [name: string]: string }, callback?: (err: Error) => void): void;
	/**
	 * Publish message to a node.
	 *
	 * @param nodeName Name of node in MServer to publish to
	 * @param message Message object
	 * @param callback Function to call when message is written to server (note: does not guarantee that e.g. nodeName actually exists)
	 */
	publish(nodeName: string, message: Message, callback?: (err: Error) => void): void;
	// Implementation
	publish(nodeName: string, ...args: any[]): void {
		if (typeof args[0] === "object") {
			var message: Message = args[0];
			this.socket.send(JSON.stringify({
				type: "publish",
				node: nodeName,
				topic: message.topic,
				data: message.data,
				headers: message.headers
			}), args[1]);
		} else {
			this.socket.send(JSON.stringify({
				type: "publish",
				node: nodeName,
				topic: args[0],
				data: args[1],
				headers: args[2]
			}), args[3]);
		}
	}
}

export = MClient;
