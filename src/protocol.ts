/**
 * Raw JSON WebSocket messages that make up the MHub protocol.
 *
 * Note: the protocol is not completely stable yet, but care is taken to try to
 * support both an older and newer version of the protocol for each version of
 * the server, to ensure smoother upgrades.
 * Most notably, adding a version identifier to the protocol is on the TODO...
 */

"use strict";

/**
 * Subscribe to `node` using `pattern`.
 *
 * Messages sent by that node matching the pattern (or any message if pattern is
 * undefined) will be sent to the client in the form of `MessageResponse`
 * messages.
 *
 * The `id` field (or `"default"`) will be set as the `subscription`
 * field in each matching message. This is helpful to route a number of
 * subscriptions to the appropriate part of your application (e.g. if your app
 * again consists of modules). Note that it is possible to have more than one
 * subscription with the same ID, e.g. to subscribe to multiple nodes.
 *
 * If a sequence number is given, a `SubAckResponse` will be sent (or an
 * `ErrorResponse`) with that sequence number.
 */
export interface SubscribeCommand {
	/**
	 * Type of command.
	 */
	type: "subscribe";
	/**
	 * Optional sequence number.
	 * If a sequence number is given, a `SubAckResponse` or `ErrorResponse` will
	 * be returned with the same sequence number.
	 * If no sequence number is given, nothing will be returned, unless an error
	 * occurred, in which case an `ErrorResponse` will be sent.
	 */
	seq?: number;
	/**
	 * Name of node to subscribe to.
	 * The node must be a Source (e.g. an Exchange, Queue, TestSource, etc.).
	 */
	node: string;
	/**
	 * Optional pattern to apply to message topics.
	 * Patterns are matched using (https://www.npmjs.com/package/minimatch),
	 * e.g. `"test*"` will match `"tester"`.
	 * If the pattern matches, it will be forwarded to the client, otherwise it
	 * will be ignored.
	 * If no pattern is given, all messages (from that node) will be forwarded.
	 */
	pattern?: string;
	/**
	 * Optional identifier to use when sending matching messages to the client.
	 * It will be set as the `subscription` field of each `MessageResponse`.
	 * If no identifier is given, `default` is used instead.
	 */
	id?: string;
}

/**
 * Publish a message to the given node.
 */
export interface PublishCommand {
	/**
	 * Type of command.
	 */
	type: "publish";
	/**
	 * Optional sequence number.
	 * If a sequence number is given, a `SubAckResponse` or `ErrorResponse` will
	 * be returned with the same sequence number.
	 * If no sequence number is given, nothing will be returned, unless an error
	 * occurred, in which case an `ErrorResponse` will be sent.
	 */
	seq?: number;
	/**
	 * Name of node to publish to.
	 * The node must be a Destination (e.g. an Exchange, Queue,
	 * ConsoleDestination, etc.).
	 */
	node: string;
	/**
	 * Message topic.
	 * Can be any string, although the format <subsystem>:<command> is suggested,
	 * e.g. "twitter:add" or "clock:arm".
	 */
	topic: string;
	/**
	 * Optional data (payload) for a message. Can be any value that can be
	 * serialized to/from JSON.
	 */
	data?: any;
	/**
	 * Optional message headers (similar to HTTP headers).
	 * When given, it must be an object of key-value pairs.
	 * Can be used to pass meta-information about a message (e.g. which servers
	 * it passed through).
	 */
	headers?: { [header: string]: string; };
}

/**
 * Check whether connection is still alive.
 */
export interface PingCommand {
	/**
	 * Type of command.
	 */
	type: "ping";
	/**
	 * Optional sequence number.
	 * If a sequence number is given, a `PingResponse` will
	 * be returned with the same sequence number.
	 * If no sequence number is given, a `PingResponse` will
	 * be returned without a sequence number.
	 */
	seq?: number;
}

/**
 * Authenticate using basic username/password.
 * Because the username and password are sent in plain-text,
 * it is recommended to only use these across SSL links.
 *
 * If login succeeds, and a sequence number is given, a
 * `LoginAckResponse` will be returned with the same sequence
 * number.
 * If login succeeds, and no sequence number is given,
 * nothing will be returned.
 * If login fails, ErrorResponse will be returned, with the
 * sequence number if given.
 */
export interface LoginCommand {
	/**
	 * Type of command.
	 */
	type: "login";
	/**
	 * Optional sequence number.
	 */
	seq?: number;
	/**
	 * Username.
	 */
	username: string;
	/**
	 * Password.
	 */
	password: string;
}

/**
 * Inform client that a new message arrived at one of its subscriptions.
 * The `id` field of the `subscribe` command (or `"default"`, if it wasn't
 * specified) is echoed back in this message's `subscription` field.
 * The latter is helpful to route a number of subscriptions to the appropriate
 * part of your application (e.g. if your app again consists of modules).
 */
export interface MessageResponse {
	/**
	 * Type of response.
	 */
	type: "message";
	/**
	 * Topic of original message.
	 */
	topic: string;
	/**
	 * (Optional) data of original message, can be any JSON-encodable value, or
	 * `undefined`.
	 */
	data?: any;
	/**
	 * Message headers (similar to HTTP headers), encoded as an object of
	 * key-value pairs.
	 */
	headers: { [header: string]: string; };
	/**
	 * ID of subscription (`SubscribeCommand.id`) or `"default"`.
	 */
	subscription: string;
}

/**
 * Response to a successful `SubscribeCommand`.
 * Only sent if the `SubscribeCommand` included a `seq` number.
 */
export interface SubAckResponse {
	/**
	 * Type of response.
	 */
	type: "suback";
	/**
	 * Sequence number of original `SubscribeCommand.seq`.
	 */
	seq: number;
}

/**
 * Response to a successful `PublishCommand`.
 * Only sent if the `PublishCommand` included a `seq` number.
 */
export interface PubAckResponse {
	/**
	 * Type of response.
	 */
	type: "puback";
	/**
	 * Sequence number of original `PublishCommand.seq`.
	 */
	seq: number;
}

/**
 * Response to a `PingCommand`.
 * Note: a server may also spontaneously send a PingAckResponse
 * without a sequence number to check whether the (TCP-)connection
 * is still alive. A client should ignore PingAckResponses
 * without a sequence number.
 */
export interface PingAckResponse {
	/**
	 * Type of response.
	 */
	type: "pingack";
	/**
	 * Sequence number of original `PingCommand.seq`.
	 */
	seq?: number;
}

/**
 * Response to a successful `LoginCommand`.
 * Only sent if the `LoginCommand` included a `seq` number.
 */
export interface LoginAckResponse {
	/**
	 * Type of response.
	 */
	type: "loginack";
	/**
	 * Sequence number of original `LoginCommand.seq`.
	 */
	seq?: number;
}

/**
 * Response to a failed command or other server error.
 * In case of a failed command, the sequence number of that command is given in
 * the `ErrorResponse`. If no sequence number was given in the command, or a
 * generic error occurred, the sequence number will be undefined, and it's
 * probably best to close and reconnect (after some time).
 */
export interface ErrorResponse {
	/**
	 * Type of response.
	 */
	type: "error";
	/**
	 * Sequence number of original command (as passed in its `seq` field),
	 * or undefined in case of a generic error, or no sequence number was given
	 * in the command.
	 */
	seq?: number;
	/**
	 * Error message.
	 */
	message: string;
}

/**
 * All supported commands (i.e. client to server).
 */
export type Command = SubscribeCommand | PublishCommand | PingCommand | LoginCommand;

/**
 * All supported responses (i.e. server to client)
 */
export type Response = MessageResponse | SubAckResponse | PubAckResponse | PingAckResponse | LoginAckResponse | ErrorResponse;
