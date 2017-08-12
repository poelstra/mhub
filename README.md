# MHub message server and client

## Introduction

[MHub](https://github.com/poelstra/mhub) is a simple, flexible message bus
using a JSON-based protocol.
It natively supports websockets, but also 'plain' TCP ports.

Because both the protocol and the messages use JSON, this makes it very
powerful, yet still simple enough to be directly implemented in e.g. a
microcontroller.

It can be used as a lightweight Javascript-only alternative to e.g. RabbitMQ or
MQTT.

This project provides:
* a message broker (`mhub-server`) for loosely coupling software components
* accompanying command-line tools (`mhub-client`) for interacting with the server and
* a library for communicating with the server using Javascript.

## Packages using MHub

* [MHub for Node-RED](https://github.com/poelstra/node-red-contrib-mhub): MHub publish/subscribe nodes for [Node-RED](https://nodered.org/)
* [MHub Relay](https://github.com/poelstra/mhub-relay): advanced message routing/transformation between MHub servers (see below)
* FIRST Lego League tournament software
  * [Display System](https://github.com/FirstLegoLeague/displaySystem)
  * [Scoring](https://github.com/FirstLegoLeague/fllscoring)
* Arduino library (not published yet, contact [me](https://github.com/poelstra) if interested)

## Concepts

### Messages

The purpose of an MHub server (`mhub-server`) is to pass messages between
connected clients.

A *message* consists of a *topic* and optionally *data* and/or *headers*.

The topic of a message typically represents e.g. a command or event, like
`clock:arm` or `twitter:add`. Data can be the countdown time,
tweet to add, etc.
Headers are for more advanced uses of the system, e.g. to support sending
messages between multiple brokers.

### Publish / subscribe (pubsub)

MHub (like many other message busses) supports the concept of publishing
messages and subscribing to topics (aka 'pubsub').

For example, a client that subscribes to all messages with the topic pattern
`twitter:*`, will receive messages published by other clients with topics such
as `twitter:add` or `twitter:remove`.

Any client can both publish messages and subscribe to other messages.
(Note: messages sent by a client will also be received by that client if it
matches one of its subscriptions).

The topic format is technically free-form, and pattern matching is done by
[minimatch](https://www.npmjs.com/package/minimatch). However, it is advised to
follow e.g. [mq-protocols](https://github.com/FirstLegoLeague/mq-protocols) to
ensure compatibility with other systems.

### Nodes and bindings

An MHub server (`mhub-server`) instance contains one or more *nodes*, on which
messages can be published or retrieved.

In many cases, the `default` node will suffice, but to allow for more
flexibility on larger systems, it is possible to define additional nodes.

For example, this mechanism can be used to:
* route tweets to an 'unmoderated' node first, pass through some moderator
  system, then send them through to a 'moderated' node (which then can have
  bindings to other nodes that are interested in these tweets, e.g. display
  nodes).
* route a subset of all messages from an mhub-server on the local network to an
  mhub-server on the Internet, e.g. for consumption by a public website.
* route team scores to both a video overlay display and dedicated score displays
  in other areas, but only route the show/hide commands of the scores view to
  the video overlay, such that the dedicated displays keep displaying their
  scores.
* create a firehose node that emits all 'non-confidential' messages for display
  on a public screen somewhere (we're targetting tech-events, right?).

For such larger systems, it is a good idea to assign every application instance
in the system (video display controller, video display, pit area display
controller, pit area display, scores subsystem, etc.) its own node.

*Bindings* then make it possible to selectively route certain messages (based on
their topic) between different nodes. A binding (optionally based on a topic
*pattern*, like subscriptions), forwards all (matching) messages from
its source node to its destination node.

These bindings can either directly be specified in the mhub-server configuration
(for routing between nodes on the same server), or through an external program
such as [mhub-relay](https://github.com/poelstra/mhub-relay) (for routing
between nodes on the same, and/or different servers).

## Basic installation and usage

To install and run the server:
```sh
npm install -g mhub
mhub-server
```

You'll now have an MHub server listening on port 13900, containing `default` and
`test` nodes.

To verify that it's working, start an `mhub-client` in listen mode and connect to
e.g. the `test` node to see a 'blib' message every five seconds:
```sh
mhub-client -n test -l
```

You should now see e.g.:
```
{ topic: 'blib', data: 3, headers: {} }
{ topic: 'blib', data: 4, headers: {} }
etc...
```

Leave the listening mhub-client running, then start another one to send a simple
test message:
```sh
mhub-client -t my:topic
```

You'll see it on the listening `mhub-client` as:
```
{ topic: 'test:topic', data: undefined, headers: {} }
```

Note that the message was sent to the `default` node (because we didn't specify
another one with `-n`). However, because the server is by default configured to
forward all messages with topic pattern `test:*` from that `default` node to the
`test` node, it does appear at the listening mhub-client started earlier.
You can see this binding in `server.conf.json`. See below for changing it
yourself.

## `mhub-client` commandline interface

The `mhub-client` commandline tool can be used to both listen for messages, or to
publish messages. See `mhub-client --help` for available commandline parameters:

```
$ mhub-client --help
Listen mode:
  mhub-client [-n <nodename>] -l [-p <topic_pattern>] [-o <output_format>]
Post mode:
  mhub-client [-n <nodename>] -t <topic> [-d <json_data>] [-h <json_headers>]
Pipe mode:
  mhub-client [-n <nodename>] -t <topic> -i <input_format> [-h <json_headers>]

Use -s [protocol://]<host>[:<port>] to specify a custom server/port.
To use SSL/TLS, use e.g. -s wss://your_host.
For self-signed certs, see --insecure.

Options:
  --help          Show help                                            [boolean]
  -s, --socket    WebSocket to connect to, specify as [protocol://]host[:port],
                  e.g. ws://localhost:13900, or wss://localhost:13900
                                [string] [required] [default: "localhost:13900"]
  -n, --node      Node to subscribe/publish to, e.g. 'test'
                                        [string] [required] [default: "default"]
  -l, --listen    Select listen mode                                   [boolean]
  -p, --pattern   Topic subscription pattern as glob, e.g. 'twitter:*'  [string]
  -o, --output    Output format, can be: human, text, jsondata, json
                                                     [string] [default: "human"]
  -t, --topic     Message topic                                         [string]
  -d, --data      Optional message data as JSON object, e.g. '"a string"' or '{
                  "foo": "bar" }'                                       [string]
  -h, --headers   Optional message headers as JSON object, e.g. '{ "my-header":
                  "foo" }'                                              [string]
  -i, --input     Read lines from stdin, post each line to server.
                  <input_format> can be: text, json                     [string]
  --insecure      Disable server certificate validation, useful for testing
                  using self-signed certificates                       [boolean]
  --key           Filename of TLS private key (in PEM format)           [string]
  --cert          Filename of TLS certificate (in PEM format)           [string]
  --ca            Filename of TLS certificate authority (in PEM format) [string]
  --passphrase    Passphrase for private key                            [string]
  --pfx           Filename of TLS private key, certificate and CA certificates
                  (in PFX or PKCS12 format). Mutually exclusive with --key,
                  --cert and --ca.                                      [string]
  --crl           Filename of certificate revocation list (in PEM format)
                                                                        [string]
  --ciphers       List of ciphers to use or exclude, separated by :     [string]
  -U, --username  Username                                              [string]
  -P, --password  Password. Note: sent in plain-text, so only use on secure
                  connection. Also note it may appear in e.g. `ps` output.
                                                                        [string]
  -v, --version   Show version number                                  [boolean]
```

### Listening for messages

Using `mhub-client`, listen mode is initiated with the `-l` parameter.

In the default (human-friendly) format, short messages are printed on a single
line, but larger messages will wrap across multiple lines. See below for options
to change this.

To simply listen for all messages on the `default` topic, use:
```sh
mhub-client -l
```

To listen for all messages on another node use e.g.:
```sh
mhub-client -l -n somenode
```

To only receive messages with a certain topic use e.g.:
```sh
mhub-client -l -n ping -p 'ping:*'
```

(Tip: use the bundled `mhub-ping` program to do a quick round-trip time measurement.)

By default, all messages are printed in a somewhat human-readable format, which
is not suitable for consumption by other programs. However, a number of output
options are available to simplify this:
* `human` (default): Outputs raw messages, but mostly without quotes
* `text`: Outputs just the data field of a message as text. Useful when
  listening to a single topic that only contains string data. Note: if data is
  an object, it will still be printed in human-readable format, and may thus
  span multiple lines.
* `json`: Outputs the full message as JSON. Every message is guaranteed to be
  printed on its own line, and contains all info in the message (topic, headers
  and data).
* `jsondata`: Outputs just the data field of a message. Every message is
  guaranteed to be printed on its own line. Useful when listening to just a
  single topic, but complex data is used.

### Publishing single messages

Publishing a single message can be done by specifying the `-t` option (and not
passing `-l` nor `-i`).

To publish a message without data to the `default` topic, use e.g.:

```sh
mhub-client -t test:something
```

Again, the `-n` option can be used to specify a custom node.
```sh
mhub-client -n ping -t ping:request
```

To pass data (and/or headers) to a message, it needs to be specified as JSON.
This means that e.g. a number can be specified directly as e.g. `42`, but a
string needs to be enclosed in double-quotes (e.g. `"something"`).
Note that shells typically parse these quotes too, so they will need to be
escaped.

For example:
```sh
# On *nix shell:
mhub-client -t my:topic -d '"some string"'
mhub-client -t my:topic -d '{ "key": "value" }'
# On Windows command prompt:
mhub-client -t my:topic -d """some string"""
mhub-client -t my:topic -d "{ ""key"": ""value"" }"
```

### Publishing multiple messages / streaming from other programs

It is possible to 'stream' messages to the bus by using the `-i` option.
Available input formats are:
* text: Every line of the input is sent as a string in the message's data field.
* json: Every line of the input is parsed as a JSON object, and used as the
  message's data field.

Example to stream tweets into an mhub-server, using the `tweet` command from
`node-tweet-cli`.
```sh
tweet login
tweet stream some_topic --json | mhub-client -t twitter:add -i json
```

### Advanced message routing and transformations

The above examples all use the bundled commandline tools to achieve simple
message routing.

For more advanced scenario's you can use e.g.:
* [MHub for Node-RED](https://github.com/poelstra/node-red-contrib-mhub): a visual programming tool for the Internet of Things
* [mhub-relay](https://github.com/poelstra/mhub-relay): allows you to connect to one or more MHub servers, subscribe to nodes,
  optionally transform messages (using simple JavaScript functions), and publish them to other nodes.

## Customizing server nodes and bindings

To customize the available nodes and bindings, create a copy of
`server.conf.json`, edit it to your needs and start the server as:
```sh
mhub-server -c <config_filename>
```

Note: the pattern in a binding can be omitted, in which case everything will
be forwarded.

Note: don't edit the `server.conf.json` file directly, because any changes to it
will be lost when you upgrade `mhub`. Edit a copy of the file instead.

### Debug logging

To assist in debugging message routing, start the server as:
```sh
mhub-server -l debug
```

Or set the `logging` option in the config file to `"debug"`:
```js
// In server.conf.json:
{
    "logging": "debug" // or: none, fatal, error, warning, info (default)
}
```

This will show incoming commands, message routing and outgoing commands,
and adds timestamps to each line.

Note: enabling debug mode will slow down message processing, especially
on a Windows console. Don't expect your 60fps mouse tracking to work then.

### Node types

MHub supports different types of nodes. When the nodes are given as an array of
strings (legacy format), all nodes are created as `Exchange` nodes.

Much more flexibility can be achieved by passing them as an object of
{ node_name: node_definition } pairs:
```js
// In server.conf.json:
{
    "nodes": {
        "nodename1": "TypeWithoutOptions",
        "nodename2": {
            "type": "TypeWithOptions",
            "options": {
                /* configuration options for this type of node */
            }
        }
    },
    /* rest of configuration file */
}
```

Currently available node types and their options:
* `Exchange`: Simplest node type. Broadcasts any incoming message to all
  subscribed clients (taking their pattern into account, of course).
* `Queue`: Forwards incoming messages to all subscribed clients (like an
  Exchange), but also stores a configurable number of messages. A new subscriber
  will receive all currently stored messages. Useful for e.g. chat applications,
  list last X tweets, etc.
  Optionally, a pattern can be given to limit which message topics will be
  remembered. Additionally, the queue can be persisted to disk, such that it
  survives `mhub-server` restarts.
  Configuration options:
  * `capacity?: number`: Number of messages to keep (default 10)
  * `pattern?: string | string[]`: Which messages (filtered by topic) to keep
    (default all)
  * `persistent?: boolean`: Whether to persist this queue to disk (default
    false)
* `TopicStore`: Forwards all messages, but also stores the last message for each
  topic. New subscribers will receive that last message (and any future state)
  of the topics. Useful for storing (simple) configuration data (e.g. URLs of
  JSON APIs), initializing all connecting displays to the same state, etc.
  Again, a topic pattern can be given, and the queue can be persisted to disk.
  * `pattern?: string | string[]`: Which messages (filtered by topic) to keep
    (default all)
  * `persistent?: boolean`: Whether to persist this queue to disk (default
    false)
* `ConsoleDestination`: Debug helper that logs all messages published to it, to
  the console.
* `PingResponder`: Useful to measure round-trip response times. When it receives
  a message with topic `ping:request`, it will respond with a message with topic
  `ping:response` and the same payload as it received in the request.
  This type of node is set up by default in the packages configuration, on a
  node called `ping`.
* `TestSource`: Source of periodic test messages. Configured by default in the
  packaged configuration as node `blib`.
  * `topic?: string`: Topic for the test messages (default "blib")
  * `interval?: number`: Delay between messages (in ms, default 5000)

You can define these in the configuration file, see the packaged
`server.conf.json` for examples.

## Configuring transports (protocols / ports)

`mhub-server` natively supports a JSON-based protocol, which is by default
served over WebSockets (port 13900). It can also be configured for websockets
over https on port 13901.

Additionally, the same JSON-based protocol is also available on a 'raw' TCP
(by default on port 13902), where each protocol command/response is transferred
as one UTF-8 encoded JSON string per line, each line terminated by a newline
(`\n`, ASCII code 10).
This allows easy integration with platforms that don't support WebSockets.

To configure which ports and transports `mhub-server` uses, use the `listen`
field in `server.conf.json`. It accepts either a single object or an array of
objects that describe one or more transports to be used.

See the configuration file and the next section for examples on setting it up.

## Using TLS / SSL

To enable TLS / SSL on the server (`wss://` instead of `ws://`), you can change your
server configuration to look like:

```js
// In server.conf.json:
{
    "listen": [
        {
            "type": "websocket",
            "port": 13901,
            "key": "key.pem",
            "cert": "cert.pem"
        }
    ],
    /* rest of configuration follows */
}
```

Note that the recommended port for MHub over secure websockets is 13901.
Also note that it is possible to enable both transports simultaneously by passing
more than one configuration object to the `listen` array.

This will still allow any client to connect. To only allow trusted clients to
connect, use something like:

```js
// In server.conf.json:
{
    "listen": [
        {
            "type": "websocket",
            "port": 13901,
            "key": "key.pem",
            "cert": "cert.pem",
            "ca": "ca.pem", // Can be omitted to use system's default
            "requestCert": true,
            "rejectUnauthorized": true
        }
    ],
    /* rest of configuration follows */
}
```

See https://nodejs.org/dist/latest-v6.x/docs/api/tls.html#tls_tls_createserver_options_secureconnectionlistener
for details on the supported options. Options that accept a Buffer (or array of
Buffers) need to be specified as filename(s) in the configuration file.

For testing purposes, it can be useful to look at [certificates for localhost](https://github.com/Daplie/localhost.daplie.com-certificates).
When using these, use `{ "type": "websocket", "port": 13901, "key": "privkey.pem", "cert": "fullchain.pem" }`.

On `mhub-client`, to enable TLS, specify a `wss://` URL.
To use client certificates, either pass `--key`, `--cert` and `--ca` options,
or the `--pfx` option.

Note: when using a self-signed server certificate, the client will refuse to
connect (`[Error: self signed certificate] code: 'DEPTH_ZERO_SELF_SIGNED_CERT'`).
In that case, either pass the server's certificate to `--ca`, or (for testing
purposes), use the `--insecure` option to ignore these errors.

## Access control

By default, everyone is allowed to connect, publish and subscribe to all
available MHub nodes and topics.

MHub supports simple username/password authentication to lock this down.

It is advised to only use these on secure (e.g. `wss://`) connections, as
the username and password are sent in plain text.

### Users

To configure users, add a `users` key to `server.conf.json`. It can either be
a string which points to a JSON file (relative paths resolved to the location
of the config file) containing an object of `{ "username": "password" }` pairs,
or such an object can be directly given in the config file itself.

Example for inline users:
```js
// server.conf.json
{
    "users": {
        "martin": "somePassword"
    }
}
```

Example for linking to a users file:
```js
// server.conf.json
{
    "users": "/path/to/users.json"
}
// users.json
{
    "martin": "somePassword"
}
```

The commandline tools (`mhub-client`, `mhub-ping`) support `-U` and `-P` options
to pass a username and password. Be advised that the commandline (and thus
password) may be visible to other users on the system through e.g. `ps`.
The MHub client library has a `login()` method.

### Permissions

Then, add a `rights` section to `server.conf.json` that specifies the rights
(publish, subscribe) for each user, and the anonymous user (denoted by the
empty string).

Rights can be specified per user, as:
* a boolean: `true` (allow everything) or `false` (allow nothing, which is
  the default)
* an object with permissions per action (`publish`, `subscribe`), which can
  again be specified as:
  * a boolean (allow/deny publish/subscribe in general)
  * a map of node-permissions, which again can be given as:
    * a boolean (allow/deny everything on this node, deny being the default already)
    * a topic pattern, or array of patterns to allow

For example:
```js
// server.conf.json
{
    "rights": {
        "": { // Anonymous/guest
            "subscribe": true,
            "publish": false
        },
        "admin": true, // allow everything
        "martin": {
            "subscribe": true, // allow all subscriptions
            "publish": {
                "someNode": true, // allow publishing all topics to node "someNode"
                "otherNode": "/some/**", // allow e.g. "/some/foo/bar" on "otherNode"
                "default": ["/some/**", "/other"] // allow e.g. "/some/foo/bar" and "/other"
            }
        }
    }
}
```

Note: for backward compatibility and ease of use in the simple case, if both
`users` and `rights` are omitted, everyone will have publish and
subscribe rights! (If only one of them is given, no-one has access.)

When a user tries to publish to a node/topic without having access, the command
will return an error (i.e. it will not silently fail).

When a user tries to subscribe to a node that is explicitly denied (or the user
is not allowed to subscribe at all), the subscribe will fail. This also prevents
a user from finding out whether a certain node exists, at all.

However, when a user subscribes to a node which is protected by a pattern,
the subscribe will succeed, although depending on the subscription pattern,
no message may ever be received on it.

For example:
```
// In server.conf.json:
{
    "rights": {
        "testUser": {
            "subscribe": {
                "node1": false,
                "node3": true,
                "node4": "/foo/**",
                "node5": ["/foo/**", "/bar"]
            }
        }
    }
}
// Examples (note: no pattern means match everything)
client.subscribe("node1") -> access denied
client.subscribe("node2") -> access denied
client.subscribe("node3") -> ok, can receive everything on this node
client.subscribe("node4") -> ok, but will only receive topics matching "/foo/**"
client.subscribe("node4", "/foo/bar/baz") -> ok, will only match "/foo/bar/baz"
client.subscribe("node4", "/bar") -> ok, but will never match anything
client.subscribe("node5", "/bar") -> ok, will only match "/bar"
```

## Using MHub from Javascript

In Node.JS, simply `npm install --save mhub` in your package, then require the client
interface as e.g.:
```js
// ES6
import MClient from "mhub";
// ES5 (commonjs)
var MClient = require("mhub").MClient;
```

Example usage of subscribing to a node and sending a message:
```js
var MClient = require("mhub").MClient;
var client = new MClient("ws://localhost:13900");
client.on("message", function(message) {
    console.log(message.topic, message.data, message.headers);
});
client.connect().then(function() {
    client.subscribe("blib"); // or e.g. client.subscribe("blib", "my:*");
    client.publish("blib", "my:topic", 42, { some: "header" });
});
```

When an error occurs (e.g. the connection is lost), the error will be emitted on
the `error` event.

It is possible (and advisable) to also listen for the `close` event to reconnect
(after some time) to the server in case the connection is lost. Note: any
subscriptions will have to be recreated upon reconnection.

For use in the browser, a (preliminary) native WebSocket version is available as
`import MHubClient from "mhub/dist/src/browserclient");`, which can then be bundled
using e.g. [browserify](http://browserify.org/) or [webpack](https://webpack.github.io/).
This client has the same interface as the Node.JS version, and will be moved to
its own package at a later stage.

API doc for MClient:
```ts
/**
 * MHub client.
 *
 * Allows subscribing and publishing to MHub server nodes.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message) Emitted when message was received (due to subscription).
 */
export declare class MClient extends events.EventEmitter {
    private _transactions;
    private _seqNo;
    private _socket;
    private _url;
    private _options;
    private _idleTimer;
    private _connected;
    /**
     * Create new connection to MServer.
     * @param url Websocket URL of MServer, e.g. ws://localhost:13900
     * @param options Optional TLS settings and other options (see
     *        https://nodejs.org/dist/latest-v6.x/docs/api/tls.html#tls_tls_connect_port_host_options_callback
     *        for the TLS settings, and `MClientOptions` for other options)
     */
    constructor(url: string, options?: MClientOptions);
    /**
     * Current Websocket, if any.
     * @return {ws} Websocket or `undefined`
     */
    readonly socket: ws;
    readonly url: string;
    /**
     * Connect to the MServer.
     * If connection is already active or pending, this is a no-op.
     * Note: a connection is already initiated when the constructor is called.
     */
    connect(): Promise<void>;
    /**
     * Disconnect from MServer.
     * Pending requests will be rejected with an error.
     * If already disconnected, this becomes a no-op.
     *
     * Note: any existing subscriptions will be lost.
     *
     * Optionally pass an error to signal abrupt failure,
     * forcefully terminating the connection.
     * The same error will be used to reject any pending
     * requests.
     * @param error (optional) Error to emit, reject transactions with, and
     *              forcefully close connection.
     */
    close(error?: Error): Promise<void>;
    /**
     * Login to server using username/password.
     *
     * Warning: the username and password are sent in plain text.
     * Only use this on secure connections such as wss://.
     *
     * @param username Username.
     * @param password Password.
     */
    login(username: string, password: string): Promise<void>;
    /**
     * Subscribe to a node. Emits the "message" event when a message is received for this
     * subscription.
     *
     * @param nodeName Name of node in MServer to subscribe to (e.g. "default")
     * @param pattern  Optional pattern glob (e.g. "namespace:*"), matches all messages if not given
     * @param id       Optional subscription ID sent back with all matching messages
     */
    subscribe(nodeName: string, pattern?: string, id?: string): Promise<void>;
    /**
     * Publish message to a node.
     *
     * @param nodeName Name of node in MServer to publish to (e.g. "default")
     * @param topic Message topic
     * @param data  Message data
     * @param headers Message headers
     */
    publish(nodeName: string, topic: string, data?: any, headers?: {
        [name: string]: string;
    }): Promise<void>;
    /**
     * Publish message to a node.
     *
     * @param nodeName Name of node in MServer to publish to (e.g. "default")
     * @param message Message object
     */
    publish(nodeName: string, message: Message): Promise<void>;
    /**
     * Ping server.
     * Mostly used to check whether connection is still alive.
     * Note that the client will automatically send pings in the
     * absence of other communication, so there should be no need to
     * manually send pings.
     *
     * @param timeout (optional) Timeout in milliseconds before rejecting
     *                the promise with an error, or infinite if not given.
     */
    ping(timeout?: number): Promise<void>;
}
/**
 * Options to be passed to MClient constructor.
 */
export interface MClientOptions extends TlsOptions {
    /**
     * When true, will not automatically connect in the
     * constructor. Connect explicitly using `#connect()`.
     */
    noImplicitConnect?: boolean;
    /**
     * Number of milliseconds of idleness (i.e. no data
     * transmitted or received) before sending a ping to
     * the server. If it doesn't respond within that same
     * interval, the connection is closed with an error.
     * Use 0 to disable.
     */
    keepalive?: number;
}
export interface TlsOptions {
    pfx?: string | Buffer;
    key?: string | string[] | Buffer | Buffer[];
    passphrase?: string;
    cert?: string | string[] | Buffer | Buffer[];
    ca?: string | string[] | Buffer | Buffer[];
    crl?: string | string[] | Buffer | Buffer[];
    ciphers?: string;
    honorCipherOrder?: boolean;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
    NPNProtocols?: string[] | Buffer;
    ALPNProtocols?: string[] | Buffer;
}
```

API doc for Message (implemented as a class for convenient construction):
```ts
/**
 * Message to be sent or received over MServer network.
 */
declare class Message {
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
    headers: {
        [name: string]: string;
    };

    /**
     * Construct message object.
     *
     * Warning: do NOT change a message once it's been passed to the pubsub framework!
     * I.e. after a call to publish() or send(), make sure to create 'fresh' instances of e.g.
     * a headers object.
     */
    constructor(topic: string, data?: any, headers?: {
        [name: string]: string;
    });
}
```

(Note: `Message` is not directly used on the wire, it is only used to pass to e.g.
`client.publish()` and received for subscriptions).

## Wire protocol

MHub typically uses JSON messages over websockets, or a line-based TCP socket.

Both transports transfer UTF-8 encoded JSON strings. In the case of WebSockets,
these are already packetized by the WebSocket protocol. In case of 'raw' TCP
sockets, each string is sent or received per line, separated by newlines (`\n`,
ASCII code 10).

Every 'raw' JSON message is an object, with a `type` field to distinguish
different commands and responses to/from MHub.

The currently supported commands and responses are documented in
`src/protocol.ts`, but here's a quick how-to on basic communication.

### Minimal publish command

The minimal command to publish an MHub message, is e.g.:
```json
{
    "type": "publish",
    "node": "default",
    "topic": "myTopic"
}
```
This will post a message without data (payload), and without any feedback from
the server (except if an error occurs).

To post a message with data, add the `data` field:
```json
{
    "type": "publish",
    "node": "default",
    "topic": "clock:arm",
    "data": {
        "countdown": 150
    }
}
```

### Sequence numbers / acks

You'll typically want to know whether your message was received in good order,
so in order to do that, you can add a `seq` field (sequence number) to the
message. Note that the sequence number should be a unique number (at least
unique across any outstanding requests).

For example, when sending:
```json
{
    "type": "publish",
    "node": "default",
    "topic": "myTopic",
    "seq": 0
}
```
the server will respond with:
```json
{
    "type": "puback",
    "seq": 0
}
```
or with e.g.
```json
{
    "type": "error",
    "message": "some error message here",
    "seq": 0
}
```

When sending a command with a sequence number, the server will *always* respond
with a response having that same sequence number (either an ack, or an error).

The only cases where the server will never send a sequence number are:
- messages received on a subscription (you'll get your `subscription` ID instead)
- errors that are not (or could not be) related to a specific command
- gratuitous pingack's, which may be sent by a future implementation of the server
  to check whether the connection is still alive

### Subscribing to nodes

To start receiving messages, you can subscribe to a node. To simply receive all
messages from node `test`, the minimal message would be:
```json
{
    "type": "subcribe",
    "node": "test"
}
```

The server will then start sending you responses such as:
```json
{
    "type": "message",
    "topic": "myTopic",
    "headers": {},
    "subscription": "default"
}
```

Again, it's probably best to include a sequence number in the `subscribe`
command in order to get feedback about its success or failure.

It's also possible to set a pattern, such that only matching topics will be
forwarded to the client.

Additionally, it's possible to provide an `id` in the `subscribe` command that
will be echoed as the `subscription` field in each message response.
This is useful if different parts of your application have different
subscriptions, and you want to route these responses to the relevant part of
your application. (Note: the same ID can be used for multiple subscriptions,
e.g. to subscribe to different nodes.)

For example:
```json
{
    "type": "subcribe",
    "node": "test",
    "pattern": "my*",
    "id": "someID",
    "seq": 1
}
```

## Contributing

All feedback and contributions are welcome!

Be sure to Star the package if you like it, leave me a
mail, submit an issue, etc.

```sh
git clone https://github.com/poelstra/mhub
cd mhub
npm install
npm test
# or run `npm run watch` for continuous compilation+running
```

The package is developed in [Typescript](http://www.typescriptlang.org/), which
adds strong typing on top of plain Javascript. It should mostly be familiar to
Javascript developers.

You can edit the `.ts` files with any editor you like, but to profit from things
like code-completion and inline documentation, I recommend using [Visual Studio Code](https://code.visualstudio.com/).
If you like SublimeText, use e.g. [Microsoft's Typescript plugin](https://packagecontrol.io/packages/TypeScript).

For other editors, to get automatic compilation and live-reload, run `npm watch`.

Please run `npm test` (mainly tslint for now, other tests still pending...)
before sending a pull-request.

## Changelog

The list below shows notable changes between each release.
For details, see the version tags at GitHub.

0.9.0 (2017-08-12):
- mhub-server: Add fine-grained permission control: publish/subscribe rights per node/topic(-pattern)
- mhub-server: Switch to `micromatch` iso `minimatch` (mostly drop-in, but may have subtle changes for intricate patterns)
- message: `clone()` and `fromObject()` now make shallow clone of headers (NOT data)
- client: Add preliminary browser client (`import MHubClient from "dist/src/browserclient"`). Note: API may change, will likely move to dedicated package in future.
- all: Update to TS 2.4.2, enabled strict null-checks

0.8.0 (2017-02-25):
- protocol: Add plaintext username/password authentication
- mhub-server: Add users and publish/subscribe permissions
- MClient: connect() and close() now return promises
- MClient: fix closing while DNS lookup still in progress

0.7.1 (2017-01-20):
- mhub-server: Handle multiple simultaneous lines received on raw tcp socket

0.7.0 (2016-11-11):
- mhub-server / MClient: implement ping command
- mhub-server: better handling of unknown messages
- MClient: Events now emitted asynchronously
- MClient: unhandled errors in event handlers will crash your program
- MClient: automatic (configurable) keep-alive checking (e.g. for network disconnects)
- MClient: don't emit close when connection was never established (e.g. on connection failure)
- MClient: option to not start connecting in constructor

0.6.0 (2016-10-29):
- mhub-server: Add `logging` option to config file, defaults to `info`, deprecates `verbose`
- mhub-server: Add `-l <level>` commandline option to override log level
- MClient: Fix crash when tlsOptions object isn't given
- MClient: Only emit generic error event when it's not specific to a certain
  request, allows to gracefully handle e.g. subscription to non-existing node
- MClient: Use ts-promise instead of native Promises

0.5.0 (2016-07-23):
- mhub-server: 'Raw' TCP support added (line-based JSON), default on port 13902
- mhub-server: Multi-transport support added (e.g. websockets + secure
  websockets + raw TCP)
- Default / recommended port for secure websockets changed to 13901
- mhub-server: `TopicState` renamed (again) to `TopicStore`, old name still
  works

0.4.0 (2016-07-19):
- mhub-server: `TopicQueue` was renamed to `TopicState` to better reflect its
  meaning
- mhub-server: No longer send acks when no sequence number was given in the
  request
- Document all protocol commands/responses and their fields in `src/protocol.ts`
  and provide quick how-to in Readme

0.3.4 (2016-07-16):
- mhub-server: Implement various node types (Exchange (old default), Queue, TopicQueue)
- mhub-server: Implement optional persistent storage for queues

0.3.3 (2016-07-04):
- Add TLS support
- mhub-server: Move `port` option to `listen` option (old one still works, but is deprecated)
- mhub-server: Add `verbose` option to config (default true)

0.3.2 (2016-06-30):
- Rename `m{client,ping,server}` to `mhub-{client,ping,server}` (old names still work, but are deprecated)
- Publish TS sources in NPM package (for source-map-support)
- Upgrade dependencies

0.3.1 (2016-02-09):
- Add "-v" option for version number
- Fix sequence number logic in MClient
- Upgrade ws to fix "invalid compressed data" errors

0.3.0 (2016-01-03):
- Update to latest TS module resolution
- Add Message#clone()
- Implement message ACKs
- ES6 imports/exports
- Move FLL-specific scripts into separate package
- Improve Readme

0.2.1 (2015-04-18):
- First public version

## License

Licensed under the MIT License, see LICENSE.txt.

Copyright (c) 2015 Martin Poelstra <martin@beryllium.net>
