/**
 * MHub Message class.
 */

/*
 TODO remove Message.headers in favour of simply adding more optional properties
      directly on Message?
 */

/**
 * Headers are key-value pairs that carry meta-information
 * about a message.
 */
export interface Headers {
	[name: string]: string;
}

/**
 * Interface describing what a 'raw' object should look like
 * if it is to be converted to a Message using `Message.fromObject()`.
 */
export interface MessageLike {
	topic: string;
	data?: any;
	headers?: Headers;
}

/**
 * Message to be sent or received over MHub network.
 */
export class Message {
	/**
	 * Topic of message.
	 * Can be used to determine routing between pubsub Nodes.
	 */
	public topic: string;

	/**
	 * Optional message data, can be null.
	 * Must be JSON serializable.
	 */
	public data: any;

	/**
	 * Optional message headers.
	 */
	public headers: Headers;

	/**
	 * Construct message object.
	 *
	 * Warning: do NOT change a message once it's been passed to the pubsub framework!
	 * I.e. after a call to publish() or send(), make sure to create 'fresh' instances of e.g.
	 * a headers object.
	 */
	constructor(topic: string, data?: any, headers?: Headers) {
		if (typeof topic !== "string") {
			throw new TypeError("invalid topic: expected string, got " + typeof topic);
		}
		this.topic = topic;
		this.data = data;
		this.headers = headers || Object.create(null); // tslint:disable-line:no-null-keyword
	}

	/**
	 * Perform a shallow clone of the message.
	 *
	 * I.e. the new message will share the same `data` as the source message,
	 * so be careful when the data is an object: making changes to it will be
	 * reflected in the old and new message.
	 *
	 * The headers (if any) will be cloned into a new headers object.
	 *
	 * @return New message with same topic, same data and shallow clone of headers.
	 */
	public clone(): Message {
		return new Message(this.topic, this.data, { ...this.headers });
	}

	/**
	 * Create a Message object from a plain object, by taking its topic, data and
	 * headers properties.
	 *
	 * Note that the data is not deep-cloned.
	 *
	 * @param o Input object. Must at least contain a `.topic` property.
	 * @return New `Message` instance, with given topic, same data, and clone of headers.
	 */
	public static fromObject(o: MessageLike): Message {
		if (!o || typeof o !== "object") {
			throw new TypeError("cannot create message from object, got " + typeof o);
		}
		if (typeof o.topic !== "string") {
			throw new TypeError("cannot create message from object, missing or invalid topic");
		}
		return new Message(o.topic, o.data, { ...o.headers });
	}
}

export default Message;
