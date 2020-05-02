/**
 * MHub Message class.
 */

/**
 * Headers are key-value pairs that carry meta-information
 * about a message.
 */
export interface Headers {
	[name: string]: string | boolean | number;
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
			throw new TypeError(
				`cannot create message from object, got ${typeof o}`
			);
		}
		return new Message(o.topic, o.data, o.headers);
	}

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
	 * Note: headers are cloned, but data is NOT cloned, so don't change data after you've
	 * passed it to the pubsub framework!
	 */
	constructor(topic: string, data?: any, headers?: Headers) {
		this.topic = topic;
		this.data = data;
		this.headers = { ...headers }; // clone
	}

	/**
	 * Perform a shallow clone of the message.
	 *
	 * I.e. the new message will share the same `data` as the source message,
	 * so be careful when the data is an object: making changes to it will be
	 * reflected in the old and new message.
	 *
	 * The headers (if any) are cloned into a new headers object.
	 *
	 * @return New message with same topic, same data and shallow clone of headers.
	 */
	public clone(): Message {
		return new Message(this.topic, this.data, this.headers);
	}

	/**
	 * Validate correctness of message properties, e.g. that topic is a string,
	 * and header is either undefined or key-values.
	 */
	public validate(): void {
		if (typeof this.topic !== "string") {
			throw new TypeError(
				`invalid topic: expected string, got ${typeof this.topic}`
			);
		}
		const headers = this.headers;
		if (headers !== undefined && typeof headers !== "object") {
			throw new TypeError(
				`invalid headers: expected object or undefined, got ${typeof headers}`
			);
		}
		for (const key in headers) {
			if (!headers.hasOwnProperty(key)) {
				continue;
			}
			const t = typeof headers[key];
			if (t !== "string" && t !== "boolean" && t !== "number") {
				throw new TypeError(
					`invalid headers: expected string, boolean or number for header '${key}', got ${t}`
				);
			}
		}
	}
}

export default Message;
