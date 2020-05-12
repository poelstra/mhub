import { EventEmitter } from "events";
import log from "./log";
import * as pubsub from "./pubsub";
import { Message } from "./message";
import { MatchSpec, Matcher, getMatcher, denyAll } from "./match";
import { Patterns, Pattern } from "./protocol";

export type SubscriptionBindings = Map<pubsub.Source, Patterns>;

class SubscriptionNode implements pubsub.Destination {
	public readonly name: string;
	public readonly source: pubsub.Source;
	public readonly patterns: Map<Pattern, MatchSpec> = new Map();
	public readonly subscription: Subscription;

	private _authMatcher: Matcher;

	constructor(
		subscription: Subscription,
		source: pubsub.Source,
		authMatcher: Matcher
	) {
		this.source = source;
		this.subscription = subscription;
		this.name = `${this.subscription.name}-${source.name}`;
		this._authMatcher = authMatcher;
	}

	// Implements pubsub.Destination, i.e. receives message from source node
	public send(message: Message): void {
		if (this._authMatcher(message.topic)) {
			this.subscription.add(message);
		}
	}

	public subscribe(pattern: Pattern): void {
		// Only bind if not already bound using this exact pattern
		if (!this.patterns.get(pattern)) {
			const matcher = getMatcher(pattern);
			this.patterns.set(pattern, matcher);
			this.source.bind(this, matcher);
		}
	}

	public unsubscribe(pattern: Pattern): void {
		pattern = pattern || "";
		const matcher = this.patterns.get(pattern);
		if (!matcher) {
			return;
		}
		this.patterns.delete(pattern);
		this.source.unbind(this, matcher);
	}

	public getPatterns(): Patterns {
		return [...this.patterns.keys()];
	}

	public setPatterns(patterns: Patterns): void {
		const current = new Set(this.patterns.keys());
		const toRemove = new Set(current);
		const toAdd = new Set<Pattern>();
		if (!Array.isArray(patterns)) {
			patterns = [patterns];
		}
		for (const pattern of patterns) {
			if (!current.has(pattern)) {
				toAdd.add(pattern);
			}
			toRemove.delete(pattern);
		}
		for (const pattern of toRemove) {
			this.unsubscribe(pattern);
		}
		for (const pattern of toAdd) {
			this.subscribe(pattern);
		}
	}

	public isEmpty(): boolean {
		return this.patterns.size === 0;
	}

	public destroy(): void {
		this.source.unbind(this);
	}
}

export interface Subscription {
	on(
		event: "message",
		handler: (message: Message, seq: number) => void
	): this;
}

export class Subscription extends EventEmitter {
	public readonly name: string;

	private _inflight: number = 0;
	private _window: number = 0;
	private _first: number = 0;
	private _messages: Message[] = [];
	private _nodes: Map<pubsub.Source, SubscriptionNode> = new Map();

	public get first(): number {
		return this._first;
	}

	public get count(): number {
		return this._messages.length;
	}

	constructor(name: string) {
		super();
		this.name = name;
	}

	public subscribe(
		source: pubsub.Source,
		pattern: Pattern,
		authMatcher: Matcher
	): void {
		let subNode = this._nodes.get(source);
		if (!subNode) {
			subNode = new SubscriptionNode(this, source, authMatcher);
			this._nodes.set(source, subNode);
		}
		subNode.subscribe(pattern);
	}

	public unsubscribe(source: pubsub.Source, pattern: Pattern): void {
		const subNode = this._nodes.get(source);
		if (!subNode) {
			return;
		}
		subNode.unsubscribe(pattern);
		if (subNode.isEmpty()) {
			subNode.destroy();
			this._nodes.delete(source);
		}
	}

	public getBindings(): SubscriptionBindings {
		const result: SubscriptionBindings = new Map();
		for (const [node, binding] of this._nodes) {
			result.set(node, binding.getPatterns());
		}
		return result;
	}

	public setBindings(
		bindings: SubscriptionBindings,
		authMatchers: Map<pubsub.Source, Matcher>
	): void {
		const current = new Set(this._nodes.keys());
		const toRemove = new Set(current);
		const toAdd = new Set<pubsub.Source>();
		for (const [source] of bindings) {
			if (!current.has(source)) {
				toAdd.add(source);
			}
			toRemove.delete(source);
		}
		for (const source of toRemove) {
			const subNode = this._nodes.get(source)!;
			this._nodes.delete(source);
			subNode.destroy();
		}
		for (const source of toAdd) {
			const authMatcher = authMatchers.get(source) ?? denyAll;
			const subNode = new SubscriptionNode(this, source, authMatcher);
			this._nodes.set(source, subNode);
			subNode.setPatterns(bindings.get(source)!);
		}
	}

	public destroy(): void {
		for (const [, subNode] of this._nodes) {
			subNode.destroy();
		}
		this._nodes.clear();
	}

	public disconnect(): void {
		this.emit("close");
	}

	public connect(): void {
		this.disconnect();
		this._inflight = 0;
		this._window = 0;
	}

	public ack(until: number, window?: number): void {
		if (this._window === Infinity) {
			throw new Error("cannot ack messages on non-session subscriptions");
		}
		// Some example numbers:
		// first = 10, inflight = 2, window = 2
		// messages = [10, 11, 12, 13]
		// -> acks of message 10 and 11 would be valid, and
		//    would release 1 or 2 more messages, respectively
		if (until < this._first) {
			throw new Error(`invalid ack: older than first message`);
		}
		if (until > this._first + this._messages.length) {
			throw new Error(`invalid ack: newer than last message`);
		}
		const toAck = until - this._first;
		this._first += toAck;
		this._inflight -= toAck;
		if (this._inflight < 0) {
			// After connect, we initially reset inflight, but it could
			// be that client actually did see some of our messages already
			this._inflight = 0;
		}
		this._messages = this._messages.slice(toAck);
		if (window !== undefined) {
			this._window = window;
		}
		this._flush();
	}

	public autoAck(): void {
		if (this._first !== 0 || this._messages.length !== 0) {
			throw new Error(
				"assertion error: autoAck can only be enabled on unused subscriptions"
			);
		}
		this._window = Infinity;
	}

	public add(message: Message): void {
		log.debug("-> %s", this.name, message.topic);
		this._messages.push(message);
		this._flush();
	}

	private _flush(): void {
		while (
			this._messages.length > this._inflight &&
			this._inflight < this._window
		) {
			const message = this._messages[this._inflight];
			this._inflight++;
			const seq = this._first + this._inflight;
			this.emit("message", message, seq);
		}
		// For non-session-aware clients, just auto-ack every message
		if (this._window === Infinity) {
			this._first += this._inflight;
			this._inflight = 0;
			this._messages = [];
		}
	}
}

export enum SessionType {
	Volatile,
	Memory,
	// Persistent,
}

export interface SessionConnection {
	message(message: Message, id: string, seq: number): void;
	detach(): void;
}

export interface Session {
	on(event: "destroy", handler: () => void): this;
}

export class Session extends EventEmitter {
	private _name: string;
	private _type: SessionType;
	private _subscriptions: Map<string, Subscription> = new Map();
	private _connection: SessionConnection | undefined;
	private _destroyed: boolean = false;

	constructor(name: string, type: SessionType) {
		super();
		this._name = name;
		this._type = type;
	}

	public findSubscription(id: string): Subscription | undefined {
		this._ensureNotDestroyed();
		return this._subscriptions.get(id);
	}

	public getSubscription(id: string): Subscription {
		this._ensureNotDestroyed();
		const sub = this._subscriptions.get(id);
		if (!sub) {
			throw new Error(`unknown subscription '${id}'`);
		}
		return sub;
	}

	public getOrCreateSubscription(id: string): Subscription {
		this._ensureNotDestroyed();
		const sub = this._ensureSubscription(id);
		return sub;
	}

	public setSubscriptions(subscriptions: string[]): void {
		this._ensureNotDestroyed();
		const current = new Set(this._subscriptions.keys());
		const toRemove = new Set(current);
		const toAdd = new Set<string>();
		for (const id of subscriptions) {
			if (!current.has(id)) {
				toAdd.add(id);
			}
			toRemove.delete(id);
		}
		for (const id of toRemove) {
			const sub = this._subscriptions.get(id)!;
			this._subscriptions.delete(id);
			sub.destroy();
		}
		for (const id of toAdd) {
			this._ensureSubscription(id);
		}
	}

	private _ensureSubscription(id: string): Subscription {
		let sub = this._subscriptions.get(id);
		if (!sub) {
			sub = new Subscription(`${this._name}-${id}`);
			sub.on("message", (message, seq) => {
				this._connection?.message(message, id, seq);
			});
			if (this._type === SessionType.Volatile) {
				// Non-session-aware clients get all messages delivered
				// without the need for manual ack.
				sub.autoAck();
			}
			this._subscriptions.set(id, sub);
		}
		return sub;
	}

	/**
	 * Attach to session.
	 * This will detach any existing connection.
	 */
	public attach(connection: SessionConnection): void {
		this._ensureNotDestroyed();
		if (this._connection) {
			this.detach();
		}
		this._connection = connection;
		this._subscriptions.forEach((sub) => sub.connect());
	}

	/**
	 * Detach from session.
	 * If the session is volatile, this will destroy it, otherwise
	 * the session will stay alive.
	 */
	public detach(): void {
		this._ensureNotDestroyed();
		if (!this._connection) {
			return;
		}
		this._connection.detach();
		this._connection = undefined;
		if (this._type === SessionType.Volatile) {
			this.destroy();
		}
	}

	/**
	 * Destroy session.
	 */
	public destroy(): void {
		this._ensureNotDestroyed();
		if (this._connection) {
			this.detach();
		}
		this.emit("destroy");
		for (const [, sub] of this._subscriptions) {
			sub.destroy();
		}
		this._subscriptions.clear();
		this.removeAllListeners();
	}

	private _ensureNotDestroyed(): void {
		if (this._destroyed) {
			throw new Error("session is already destroyed");
		}
	}
}
