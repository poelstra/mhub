import Hub from "../hub";
import log from "../log";
import { getMatcher, MatchSpec } from "../match";
import Message from "../message";
import * as pubsub from "../pubsub";
import { Storage } from "../storage";
import { KeyValues } from "../types";

export interface HeaderStoreOptions {
	persistent?: boolean; // If true (default), uses hub's persistent storage (typically disk)
}

const HEADER_STORE_STORAGE_ID = "HeaderStoreStorage";
const HEADER_STORE_STORAGE_VERSION = 1;

interface HeaderStoreStorage {
	type: string;
	version: number;
	state: KeyValues<Message>;
}

const DEFAULT_OPTIONS: HeaderStoreOptions = {
	persistent: true,
};

const MESSAGE_HEADER_NAME = "keep";

/**
 * Selectively remember messages (per topic) based on the presence of certain
 * message headers.
 *
 * Behavior is determined by the `keep` header:
 * { keep: true } -> Store message, replacing previous message with same topic if any
 * { keep: false } -> Remove any stored message for this topic (and pass this one on)
 * { } -> Just pass message on, without impacting any stored message for this topic
 *
 * When a new Destination binds to this, all currently remembered topics are
 * sent to it.
 */
export class HeaderStore extends pubsub.BaseSource implements pubsub.Initializable {
	public name: string;

	// tslint:disable-next-line:no-null-keyword
	private _state: KeyValues<Message> = Object.create(null);
	private _storage: Storage<HeaderStoreStorage> | undefined;
	private _options: HeaderStoreOptions;

	constructor(name: string, options?: HeaderStoreOptions) {
		super(name);
		this.name = name;
		options = { ...DEFAULT_OPTIONS, ...options };
		this._options = options;
	}

	public init(hub: Hub): Promise<void> {
		if (this._options.persistent) {
			this._storage = hub.getStorage();
		}
		if (!this._storage) {
			return Promise.resolve(undefined);
		}
		return this._storage.load(this.name).then((data?: HeaderStoreStorage) => {
			if (!data || typeof data !== "object") {
				return;
			}
			if (data.type !== HEADER_STORE_STORAGE_ID || data.version !== HEADER_STORE_STORAGE_VERSION) {
				log.warning(`Warning: discarding invalid storage ID / version for node '${this.name}'`);
				return;
			}
			// tslint:disable-next-line:forin
			for (const topic in data.state) {
				this._state[topic] = Message.fromObject(data.state[topic]);
			}
		});
	}

	public send(message: Message): void {
		log.push("-> %s", this.name, message.topic);

		const topic = message.topic;
		const keep = message.headers[MESSAGE_HEADER_NAME];
		if (keep !== undefined) {
			// First delete, then insert to maintain message order
			delete this._state[topic];
			if (keep) {
				this._state[topic] = message;
			}
			if (this._storage) {
				this._storage.save(this.name, {
					type: HEADER_STORE_STORAGE_ID,
					version: HEADER_STORE_STORAGE_VERSION,
					state: this._state,
				}).catch((err: any) => {
					log.error(`Error saving topic data in node '${this.name}': ${err}`);
					// TODO replace with a more appropriate mechanism
					process.exit(1);
				});
			}
		}

		// Forward the message to all subscribers
		this._broadcast(message);

		log.pop();
	}

	public bind(destination: pubsub.Destination, pattern?: MatchSpec): void {
		super.bind(destination, pattern);
		const matcher = getMatcher(pattern);
		// tslint:disable-next-line:forin
		for (const topic in this._state) {
			if (matcher(topic)) {
				destination.send(this._state[topic]);
			}
		}
	}
}

export default HeaderStore;
