import { KeyValues } from "../types";
import * as pubsub from "../pubsub";
import Message from "../message";
import { Matcher, getMatcher } from "../match";
import { Storage, getDefaultStorage } from "../storage";

import log from "../log";

export interface TopicQueueOptions extends pubsub.BaseSource {
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all topics
	persistent?: boolean; // If true, queue will be persisted to storage (typically disk)
}

const TopicQueueStorageID = "TopicQueueStorage";
const TopicQueueStorageVersion = 1;

interface TopicQueueStorage {
	type: string;
	version: number;
	queue: KeyValues<Message>;
};

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
	private _storage: Storage<TopicQueueStorage>;

	constructor(name: string, options?: TopicQueueOptions) {
		super(name, options);
		this.name = name;
		this._matcher = getMatcher(options && options.pattern);
		if (options.persistent) {
			this._storage = getDefaultStorage();
		}
	}

	public init(): Promise<void> {
		if (!this._storage) {
			return Promise.resolve(undefined);
		}
		return this._storage.load(this.name).then((data?: TopicQueueStorage) => {
			if (!data || typeof data !== "object") {
				return;
			}
			if (data.type !== TopicQueueStorageID || data.version !== TopicQueueStorageVersion) {
				console.log(`Warning: discarding invalid storage ID / version for node '${this.name}'`);
				return;
			}
			for (const topic in data.queue) {
				this._queue[topic] = Message.fromObject(data.queue[topic]);
			}
		});
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
			if (this._storage) {
				this._storage.save(this.name, {
					type: TopicQueueStorageID,
					version: TopicQueueStorageVersion,
					queue: this._queue
				});
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
