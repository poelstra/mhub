/**
 * MHub pubsub fabric: nodes and bindings.
 * Provides the basic routing infrastructure to send and receive messages.
 */

import * as minimatch from "minimatch";
import Promise from "ts-promise";

import Message from "./message";

interface Matcher {
	pattern: string;
	filter: (topic: string, indexed?: number, array?: string[]) => boolean;
}

interface Binding {
	matchers: Matcher[];
	destination: Destination;
}

export interface Initializable {
	init?(): Promise<void>;
}

export interface Destination extends Initializable {
	name: string;
	send(message: Message): void;
}

export interface Source extends Initializable {
	name: string;
	bind(destination: Destination, pattern?: string): void;
	unbind(destination: Destination, pattern?: string): void;
}

export function isDestination(node: BaseNode | undefined): node is Destination {
	return node && typeof (<any>node).send === "function";
}

export function isSource(node: BaseNode | undefined): node is Source {
	return node && typeof (<any>node).bind === "function" && typeof (<any>node).unbind === "function";
}

export type BaseNode = Source | Destination;

export interface BaseSourceOptions {
}

export class BaseSource implements Source {
	public name: string;

	private _bindings: Binding[] = [];

	constructor(name: string, options?: BaseSourceOptions) {
		this.name = name;
	}

	public bind(destination: Destination, pattern?: string): void {
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
				destination: destination,
			};
			this._bindings.push(b);
		}
		// Create pattern matcher for this destination
		b.matchers.push({
			pattern: (pattern) ? pattern : "",
			filter: (pattern) ? minimatch.filter(pattern) : (topic: string): boolean => true,
		});
	}

	public unbind(destination: Destination, pattern?: string): void {
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
		}
	}

	protected _broadcast(message: Message): void {
		this._bindings.forEach((b: Binding): void => {
			if (b.matchers.some((m: Matcher): boolean => m.filter(message.topic))) {
				b.destination.send(message);
			}
		});
	}
}
