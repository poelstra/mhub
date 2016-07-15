/**
 * MHub Message class.
 */

"use strict";

/*
 TODO remove Message.headers in favour of simply adding more optional properties
      directly on Message?
 */

export interface Headers {
	[name: string]: string;
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

	public clone(): Message {
		return new Message(this.topic, this.data, this.headers);
	}

	public static fromObject(o: any): Message {
		if (!o || typeof o !== "object") {
			throw new TypeError("cannot create message from object, got " + typeof o);
		}
		return new Message(o.topic, o.data, o.headers);
	}
}

export default Message;
