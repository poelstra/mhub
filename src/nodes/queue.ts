import { getMatcher, Matcher, MatchSpec } from "../match";
import Message from "../message";
import * as pubsub from "../pubsub";
import { Storage } from "../storage";

import Hub from "../hub";
import log from "../log";

export interface QueueOptions {
	capacity?: number; // Maximum queue size (in number of messages)
	pattern?: string | string[]; // Topic patterns to memorize, defaults to all messages
	persistent?: boolean; // If true, queue will be persisted to storage (typically disk)
}

const QUEUE_STORAGE_ID = "QueueStorage";
const QUEUE_STORAGE_VERSION = 1;

interface QueueStorage {
	type: string;
	version: number;
	queue: Message[];
}

export class Queue extends pubsub.BaseSource implements pubsub.Initializable {
	public name: string;
	public capacity: number;

	private _queue: Message[] = [];
	private _matcher: Matcher;
	private _storage: Storage<QueueStorage> | undefined;
	private _options: QueueOptions;

	constructor(name: string, options?: QueueOptions) {
		super(name);
		this.name = name;
		this.capacity = options && options.capacity || 10;
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
		return this._storage.load(this.name).then((data?: QueueStorage) => {
			if (!data || typeof data !== "object") {
				return;
			}
			if (data.type !== QUEUE_STORAGE_ID || data.version !== QUEUE_STORAGE_VERSION) {
				log.warning(`Warning: discarding invalid storage ID / version for node '${this.name}'`);
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
					type: QUEUE_STORAGE_ID,
					version: QUEUE_STORAGE_VERSION,
					queue: this._queue,
				}).catch((err: any) => {
					log.error(`Error saving topic data in node '${this.name}': ${err}`);
					// TODO replace with a more appropriate mechanism
					process.exit(1);
				});
			}
		}
	}

	public bind(destination: pubsub.Destination, pattern?: MatchSpec): void {
		super.bind(destination, pattern);
		const matcher = getMatcher(pattern);
		this._queue.forEach((msg: Message): void => {
			if (matcher(msg.topic)) {
				destination.send(msg);
			}
		});
	}
}

export default Queue;
