import { KeyValues } from "../types";
import * as pubsub from "../pubsub";
import Message from "../message";
import { Matcher, getMatcher } from "../match";

import log from "../log";

export interface TopicQueueOptions extends pubsub.BaseSource {
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all topics
}

/**
 * Remember last message for each topic.
 *
 * A new message with the same topic will overwrite the last message with that
 * topic, unless the `data` part of the message is `undefined`, in which case
 * the message is deleted from memory.
 *
 * When a new Destination binds to this, all currently remembered topics are
 * sent to it.
 */
export class TopicQueue extends pubsub.BaseSource {
	public name: string;

	private _queue: KeyValues<Message> = Object.create(null);
	private _matcher: Matcher;

	constructor(name: string, options?: TopicQueueOptions) {
		super(name, options);
		this.name = name;
		this._matcher = getMatcher(options && options.pattern);
	}

	public send(message: Message): void {
		// Forward the message to all subscribers
		log.push("-> %s", this.name, message.topic);
		this._broadcast(message);
		log.pop();

		// Store or delete this message if it matches the pattern
		const topic = message.topic;
		if (this._matcher(topic)) {
			if (message.data === undefined) {
				delete this._queue[topic];
			} else {
				this._queue[topic] = message;
			}
		}
	}

	public bind(destination: pubsub.Destination, pattern?: string): void {
		super.bind(destination, pattern);
		for (const topic in this._queue) {
			destination.send(this._queue[topic]);
		}
	}
}

export default TopicQueue;
