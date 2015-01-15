/// <reference path="../typings/tsd.d.ts" />

"use strict";

import minimatch = require("minimatch");

import d = require("./debug");
import debug = d.debug;

interface Matcher {
	pattern: string;
	filter: (topic: string) => boolean;
}

interface Binding {
	matchers: Matcher[];
	destination: Destination;
}

/**
 * Message to be sent over pubsub network.
 *
 * Warning: do NOT change a message once it's been passed to the pubsub framework!
 */
export class Message {
	/**
	 * Topic of message.
	 * Can be used to determine routing between pubsub Nodes.
	 */
	topic: string;

	/**
	 * Optional message data, can be null.
	 * Must be JSON serializable.
	 */
	data: any;

	/**
	 * Optional message headers.
	 */
	headers: { [name: string]: string };

	/**
	 * Construct message object.
	 *
	 * Warning: do NOT change a message once it's been passed to the pubsub framework!
	 */
	constructor(topic: string, data: any = null, headers?: { [name: string]: string }) {
		if (typeof topic !== "string") {
			throw new TypeError("invalid topic: expected string, got " + typeof topic);
		}
		this.topic = topic;
		this.data = data;
		this.headers = headers || Object.create(null);
	}
}

export interface Destination {
	name: string;
	send(message: Message): void;
}

export class Node implements Destination {
	private _bindings: Binding[] = [];

	constructor(public name: string) {
	}

	bind(destination: Destination, pattern?: string): void {
		var b: Binding;
		// Find existing bindings to this destination
		for (var i = 0; i < this._bindings.length; i++) {
			if (this._bindings[i].destination === destination) {
				b = this._bindings[i];
				break;
			}
		}
		// Create binding to this destination if it's the first one
		if (!b) {
			b = {
				matchers: [],
				destination: destination
			};
			this._bindings.push(b);
		}
		// Create pattern matcher for this destination
		b.matchers.push({
			pattern: (pattern) ? pattern : "",
			filter: (pattern) ? minimatch.filter(pattern) : (topic: string): boolean => true
		});
	}

	unbind(destination: Destination, pattern?: string): void {
		if (!pattern) {
			// Remove all bindings to given destination
			this._bindings = this._bindings.filter((b: Binding): boolean => {
				var remove = b.destination === destination;
				return !remove;
			});
		} else {
			// Remove only specific binding to destination
			this._bindings = this._bindings.filter((b: Binding): boolean => {
				b.matchers = b.matchers.filter((m: Matcher): boolean => {
					var remove = m.pattern === pattern;
					return !remove;
				});
				return b.matchers.length > 0;
			});
		};
	}

	send(message: Message): void {
		debug.push("-> %s", this.name, message);
		this._bindings.forEach((b: Binding): void => {
			if (b.matchers.some((m: Matcher): boolean => m.filter(message.topic))) {
				b.destination.send(message);
			}
		});
		debug.pop();
	}
}

export interface Subscription {
	instance: string;
	iterator: string;
}

export class Queue extends Node {
	private queue: Message[] = [];

	constructor(public name: string, public size: number = 10) {
		super(name);
	}

	send(message: Message): void {
		this.queue.push(message);
		while (this.queue.length > this.size) {
			this.queue.shift();
		}
		super.send(message);
	}

	bind(dest: Destination): void;
	bind(dest: Destination, subscription?: Subscription): void;
	bind(dest: Destination, subscription?: Subscription): void {
		super.bind(dest);
		this.queue.forEach((msg: Message): void => {
			dest.send(msg);
		});
	}
}

export class ConsoleDestination implements Destination {
	constructor(public name: string) {
	}

	send(message: Message): void {
		console.log("[" + this.name + "]", message);
	}
}
