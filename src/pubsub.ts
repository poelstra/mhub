/**
 * MServer pubsub fabric: nodes and bindings.
 * Provides the basic routing infrastructure to send and receive messages.
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import minimatch = require("minimatch");

import log = require("./log");

import Message = require("./Message");

interface Matcher {
	pattern: string;
	filter: (topic: string) => boolean;
}

interface Binding {
	matchers: Matcher[];
	destination: Destination;
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
		log.push("-> %s", this.name, message.topic);
		this._bindings.forEach((b: Binding): void => {
			if (b.matchers.some((m: Matcher): boolean => m.filter(message.topic))) {
				b.destination.send(message);
			}
		});
		log.pop();
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
