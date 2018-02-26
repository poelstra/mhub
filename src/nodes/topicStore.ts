import Promise from "ts-promise";

import { getMatcher, Matcher, MatchSpec } from "../match";
import Message from "../message";
import * as pubsub from "../pubsub";
import { Storage } from "../storage";
import { KeyValues } from "../types";

import Hub from "../hub";
import log from "../log";

export interface TopicStoreOptions {
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all topics
	persistent?: boolean; // If true, state will be persisted to storage (typically disk)
}

const TOPIC_STORE_STORAGE_ID = "TopicStoreStorage";
const TOPIC_STORE_STORAGE_VERSION = 1;

interface TopicStoreStorage {
	type: string;
	version: number;
	state: KeyValues<Message>;
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
export class TopicStore extends pubsub.BaseSource implements pubsub.Initializable {
	public name: string;

	// tslint:disable-next-line:no-null-keyword
	private _state: KeyValues<Message> = Object.create(null);
	private _matcher: Matcher;
	private _storage: Storage<TopicStoreStorage> | undefined;
	private _options: TopicStoreOptions;

	constructor(name: string, options?: TopicStoreOptions) {
		super(name);
		this.name = name;
		this._matcher = getMatcher(options && options.pattern);
		this._options = options || {};
	}

	public init(hub: Hub): Promise<void> {
		if (this._options.persistent) {
			this._storage = hub.getStorage();
		}
		if (!this._storage) {
			return Promise.resolve(undefined);
		}
		return this._storage.load(this.name).then((data?: TopicStoreStorage) => {
			if (!data || typeof data !== "object") {
				return;
			}
			if (
					(data.type !== TOPIC_STORE_STORAGE_ID && data.type !== "TopicStateStorage") ||
					data.version !== TOPIC_STORE_STORAGE_VERSION
				) {
				// tslint:disable-next-line:no-console
				console.log(`Warning: discarding invalid storage ID / version for node '${this.name}'`);
				return;
			}
			// tslint:disable-next-line:forin
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
					type: TOPIC_STORE_STORAGE_ID,
					version: TOPIC_STORE_STORAGE_VERSION,
					state: this._state,
				});
			}
		}
	}

	public bind(destination: pubsub.Destination, pattern?: MatchSpec): void {
		super.bind(destination, pattern);
		// tslint:disable-next-line:forin
		for (const topic in this._state) {
			destination.send(this._state[topic]);
		}
	}
}

export default TopicStore;
