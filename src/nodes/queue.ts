import Promise from "ts-promise";

import * as pubsub from "../pubsub";
import Message from "../message";
import { Matcher, getMatcher } from "../match";
import { Storage, getDefaultStorage } from "../storage";

import log from "../log";

export interface QueueOptions extends pubsub.BaseSource {
	capacity?: number; // Maximum queue size (in number of messages)
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all messages
	persistent?: boolean; // If true, queue will be persisted to storage (typically disk)
}

const QueueStorageID = "QueueStorage";
const QueueStorageVersion = 1;

interface QueueStorage {
	type: string;
	version: number;
	queue: Message[];
};

export class Queue extends pubsub.BaseSource {
	public name: string;
	public capacity: number;

	private _queue: Message[] = [];
	private _matcher: Matcher;
	private _storage: Storage<QueueStorage>;

	constructor(name: string, options?: QueueOptions) {
		super(name, options);
		this.name = name;
		this.capacity = options && options.capacity || 10;
		this._matcher = getMatcher(options && options.pattern);
		if (options.persistent) {
			this._storage = getDefaultStorage();
		}
	}

	public init(): Promise<void> {
		if (!this._storage) {
			return Promise.resolve(undefined);
		}
		return this._storage.load(this.name).then((data?: QueueStorage) => {
			if (!data || typeof data !== "object") {
				return;
			}
			if (data.type !== QueueStorageID || data.version !== QueueStorageVersion) {
				console.log(`Warning: discarding invalid storage ID / version for node '${this.name}'`);
				return;
			}
			for (const msg of data.queue) {
				this._queue.push(Message.fromObject(msg));
			}
		});
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
			if (this._storage) {
				this._storage.save(this.name, {
					type: QueueStorageID,
					version: QueueStorageVersion,
					queue: this._queue
				});
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
