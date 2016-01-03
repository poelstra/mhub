/**
 * MServer Message class.
 */

"use strict";

/**
 * Message to be sent or received over MServer network.
 */
class Message {
	/**
	 * Topic of message.
	 * Can be used to determine routing between pubsub Nodes.
	 */
	topic: string;

	/**
	 * Optional message data, can be null.
	 * Must be JSON serializable.
	 */
	data: any;

	/**
	 * Optional message headers.
	 */
	headers: { [name: string]: string };

	/**
	 * Construct message object.
	 *
	 * Warning: do NOT change a message once it's been passed to the pubsub framework!
	 * I.e. after a call to publish() or send(), make sure to create 'fresh' instances of e.g.
	 * a headers object.
	 */
	constructor(topic: string, data?: any, headers?: { [name: string]: string }) {
		if (typeof topic !== "string") {
			throw new TypeError("invalid topic: expected string, got " + typeof topic);
		}
		this.topic = topic;
		this.data = data;
		this.headers = headers || Object.create(null);
	}

	clone(): Message {
		return new Message(this.topic, this.data, this.headers);
	}
}

export default Message;
