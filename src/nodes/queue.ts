import * as pubsub from "../pubsub";
import Message from "../message";
import { Matcher, getMatcher } from "../match";

import log from "../log";

export interface QueueOptions extends pubsub.BaseSource {
	capacity?: number; // Maximum queue size (in number of messages)
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all messages
}

export class Queue extends pubsub.BaseSource {
	public name: string;
	public capacity: number;

	private _queue: Message[] = [];
	private _matcher: Matcher;

	constructor(name: string, options?: QueueOptions) {
		super(name, options);
		this.name = name;
		this.capacity = options && options.capacity || 10;
		this._matcher = getMatcher(options && options.pattern);
	}

	public send(message: Message): void {
		// Forward the message to all subscribers
		log.push("-> %s", this.name, message.topic);
		this._broadcast(message);
		log.pop();

		// Store this message if it matches the pattern
		if (this._matcher(message.topic)) {
			this._queue.push(message);
			while (this._queue.length > this.capacity) {
				this._queue.shift();
			}
		}
	}

	public bind(destination: pubsub.Destination, pattern?: string): void {
		super.bind(destination, pattern);
		this._queue.forEach((msg: Message): void => {
			destination.send(msg);
		});
	}
}

export default Queue;
