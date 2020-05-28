/**
 * Raw JSON WebSocket messages that make up the MHub protocol.
 *
 * Note: the protocol is not completely stable yet, but care is taken to try to
 * support both an older and newer version of the protocol for each version of
 * the server, to ensure smoother upgrades.
 * Most notably, adding a version identifier to the protocol is on the TODO...
 */

/**
 * Subscribe to `node` using `pattern`.
 *
 * Messages sent by that node matching the `pattern` (or any message if `pattern`
 * is omitted) will be sent to the client in the form of `MessageResponse`
 * messages.
 *
 * The `id` field (or `"default"`) will be set as the `subscription`
 * field in each matching message. This is helpful to route a number of
 * subscriptions to the appropriate part of your application (e.g. if your app
 * again consists of modules).
 *
 * Multiple subscriptions with the exact same `pattern` and `id` will be ignored.
 *
 * When subscribing using the same or overlapping patterns, any matching
 * message will be sent just once to a single subscription ID.
 * For example, when sending:
 * - { type: "subscribe", node: "default", pattern: "ja*", id: "subscription 1" }
 * - { type: "subscribe", node: "default", pattern: "*ja", id: "subscription 1" }
 * - { type: "subscribe", node: "default", pattern: "ja*", id: "subscription 2" }
 * - { type: "publish", node: "default", topic: "jaja" }
 * The following will be received:
 * - { type: "message", topic: "jaja", id: "subscription 1" }
 * - { type: "message", topic: "jaja", id: "subscription 2" }
 *
 * If no `pattern` is given, this is mostly equivalent to the pattern `"**"` (which
 * also matches everything), except that when unsubscribing without a pattern,
 * everything will be unsubscribed (for that node and id), whereas unsubscribing
 * `"**"` will leave any other patterns intact. (It's not very useful to have other
 * subscriptions when subscribing using an empty pattern or "**", of course.)
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
	 * Optional pattern(s) to apply to message topics.
	 * Patterns are matched using (https://www.npmjs.com/package/micromatch),
	 * e.g. `"test*"` will match `"tester"`.
	 * If any of the pattern matches, it will be forwarded to the client, otherwise it
	 * will be ignored.
	 * If no pattern is given, all messages (from that node) will be forwarded.
	 */
	pattern?: string | string[];
	/**
	 * Optional identifier to use when sending matching messages to the client.
	 * It will be set as the `subscription` field of each `MessageResponse`.
	 * If no identifier is given, `"default"` is used instead.
	 */
	id?: string;
}

/**
 * Unsubscribe from `node` using `pattern`.
 *
 * If `pattern` is omitted all subscriptions on given `node`
 * for given `id` (or `"default"`) will be unsubscribed.
 *
 * If `id` is omitted, `"default"` is used.
 *
 * If a sequence number is given, a `UnsubAckResponse` will be sent (or an
 * `ErrorResponse`) with that sequence number.
 *
 * If combination of `id` and `pattern` aren't found, this will be
 * ignored (i.e. it's not an error, and `UnsubAckResponse` will be sent).
 */
export interface UnsubscribeCommand {
	/**
	 * Type of command.
	 */
	type: "unsubscribe";
	/**
	 * Optional sequence number.
	 * If a sequence number is given, a `UnsubAckResponse` or `ErrorResponse` will
	 * be returned with the same sequence number.
	 * If no sequence number is given, nothing will be returned, unless an error
	 * occurred, in which case an `ErrorResponse` will be sent.
	 */
	seq?: number;
	/**
	 * Name of node to unsubscribe from.
	 * The node must be a Source (e.g. an Exchange, Queue, TestSource, etc.).
	 */
	node: string;
	/**
	 * Optional pattern(s) to unsubscribe.
	 * If no pattern is given, all subscriptions on given `node` and `id` will be
	 * unsubscribed.
	 */
	pattern?: string | string[];
	/**
	 * Optional identifier for matching a subscription.
	 * If no identifier is given, `"default"` is used instead.
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
	headers?: { [header: string]: string | boolean | number };
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
	headers: { [header: string]: string | boolean | number };
	/**
	 * ID of subscription (`SubscribeCommand.id`) or `"default"`.
	 */
	subscription: string;
	/**
	 * Sequence number of message, if message is sent in a session.
	 * In that case, the message must be acked in order to keep receiving
	 * new messages. Depending on the window size, messages may be acked
	 * in batches.
	 */
	seq?: number;
}

export interface AckCommand {
	type: "ack";
	id: string;
	ack: number;
	window?: number;
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
 * Response to a successful `UnsubscribeCommand`.
 * Only sent if the `UnsubscribeCommand` included a `seq` number.
 */
export interface UnsubAckResponse {
	/**
	 * Type of response.
	 */
	type: "unsuback";
	/**
	 * Sequence number of original `UnsubscribeCommand.seq`.
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

export interface SessionCommand {
	type: "session";
	name: string;
	seq?: number;
	subscriptions?: string[];
}

export interface SessionAckResponse {
	type: "sessionack";
	seq?: number;
	// TODO Add list of subscriptions when not given in SessionCommand?
}

/**
 * Topic pattern.
 * If empty string, matches everything.
 */
export type Pattern = string;

/**
 * Array of topic patterns.
 * If empty, will match nothing.
 * Duplicate patterns are ignored.
 */
export type Patterns = Pattern[];

export interface Bindings {
	[nodeName: string]: Patterns;
}

export interface SubscriptionCommand {
	type: "subscription";
	seq?: number;
	id: string;
	bindings?: Bindings;
}

export interface SubscriptionAckResponse {
	type: "subscriptionack";
	seq: number;
	bindings?: Bindings;
	lastAck: number;
}

/**
 * All supported requests (i.e. client to server) that (can) have a response.
 */
export type InvokeCommand =
	| SubscribeCommand
	| UnsubscribeCommand
	| PublishCommand
	| PingCommand
	| LoginCommand
	| SessionCommand
	| SubscriptionCommand;

/**
 * All supported requests (i.e. client to server) that have no response.
 */
export type SendCommand = AckCommand;

/**
 * All supported requests (i.e. client to server).
 */
export type Command = InvokeCommand | SendCommand;

/**
 * All supported responses (i.e. server to client)
 */
export type Response =
	| MessageResponse
	| SubAckResponse
	| UnsubAckResponse
	| PubAckResponse
	| PingAckResponse
	| LoginAckResponse
	| ErrorResponse
	| SessionAckResponse
	| SubscriptionAckResponse;

/**
 * Interface that helps with strict null checks.
 * See hasSequenceNumber().
 */
export interface ObjectWithSequenceNumber {
	seq: number;
}

/**
 * Determine whether given object (typically a message) has a sequence number.
 * (Note: this is very different from `if (msg.seq) ...` if the sequence number
 * happens to be zero...)
 * @param msg Anything, but typically a message object with/without sequence number
 * @return true if argument is an object, and contains a numberic `seq` property
 */
export function hasSequenceNumber(msg: any): msg is ObjectWithSequenceNumber {
	return typeof msg === "object" && typeof msg.seq === "number";
}
