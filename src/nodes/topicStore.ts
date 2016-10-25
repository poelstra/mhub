import Promise from "ts-promise";

import { KeyValues } from "../types";
import * as pubsub from "../pubsub";
import Message from "../message";
import { Matcher, getMatcher } from "../match";
import { Storage, getDefaultStorage } from "../storage";

import log from "../log";

export interface TopicStoreOptions extends pubsub.BaseSource {
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all topics
	persistent?: boolean; // If true, state will be persisted to storage (typically disk)
}

const TopicStoreStorageID = "TopicStoreStorage";
const TopicStoreStorageVersion = 1;

interface TopicStoreStorage {
	type: string;
	version: number;
	state: KeyValues<Message>;
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
export class TopicStore extends pubsub.BaseSource {
	public name: string;

	private _state: KeyValues<Message> = Object.create(null);
	private _matcher: Matcher;
	private _storage: Storage<TopicStoreStorage>;

	constructor(name: string, options?: TopicStoreOptions) {
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
		return this._storage.load(this.name).then((data?: TopicStoreStorage) => {
			if (!data || typeof data !== "object") {
				return;
			}
			if (
					(data.type !== TopicStoreStorageID && data.type !== "TopicStateStorage") ||
					data.version !== TopicStoreStorageVersion
				) {
				console.log(`Warning: discarding invalid storage ID / version for node '${this.name}'`);
				return;
			}
			for (const topic in data.state) {
				this._state[topic] = Message.fromObject(data.state[topic]);
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
				delete this._state[topic];
			} else {
				this._state[topic] = message;
			}
			if (this._storage) {
				this._storage.save(this.name, {
					type: TopicStoreStorageID,
					version: TopicStoreStorageVersion,
					state: this._state
				});
			}
		}
	}

	public bind(destination: pubsub.Destination, pattern?: string): void {
		super.bind(destination, pattern);
		for (const topic in this._state) {
			destination.send(this._state[topic]);
		}
	}
}

export default TopicStore;
