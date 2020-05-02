/**
 * Simple example of setting up your own MHub server instance
 * from scratch, to integrate it in your own application backend.
 *
 * The example sets up a websocket server for external users to
 * connect to, but also connects to the hub using an internal
 * connection (like you'd e.g. use for your API backend).
 *
 * See `../nodeserver.ts` for more inspiration.
 */

import * as http from "http";
import "source-map-support/register";
import * as ws from "ws";

// Replace ".." with "mhub" in your own programs
import {
	Exchange,
	HeaderStore,
	Hub,
	LocalClient,
	log,
	LogLevel,
	Message,
	PlainAuthenticator,
	SimpleFileStorage,
	ThrottledStorage,
	WSConnection,
} from "..";

async function createHub(): Promise<Hub> {
	// Instantiate a simple authenticator. You can also easily create
	// your own by implementing the (trivial) `Authenticator` interface.
	const auth = new PlainAuthenticator();

	// Create a hub
	const hub = new Hub(auth);

	// Set up authentication and authorization
	// See README.md for more info on permissions
	auth.setUser("someUser", "somePassword");
	hub.setRights({
		"": {
			// Anonymous/guest
			subscribe: true,
			publish: false,
		},
		admin: true, // allow everything
		someUser: {
			subscribe: true, // allow all subscriptions
			publish: {
				someNode: true, // allow publishing all topics to node "someNode"
				otherNode: "/some/**", // allow e.g. "/some/foo/bar" on "otherNode"
				default: ["/some/**", "/other"], // allow e.g. "/some/foo/bar" and "/other"
			},
		},
	});

	// Create and add some nodes.
	// HeaderStore is a good all-purpose node type, which acts like an Exchange,
	// but also allows to 'pin' certain messages with a `keep: true` header.
	// By setting `persistent: true` in the node's config, such messages are
	// also persisted across reboots.
	const defaultNode = new HeaderStore("default", { persistent: true });
	const otherNode = new HeaderStore("otherNode");
	const someNode = new Exchange("someNode");
	hub.add(defaultNode);
	hub.add(otherNode);
	hub.add(someNode);

	// Set up some bindings between nodes if you need them
	someNode.bind(defaultNode, "/something/**");
	otherNode.bind(defaultNode, "/some/**");

	// Configure storage on disk by using the simple built-in storage drivers
	const simpleStorage = new ThrottledStorage(
		new SimpleFileStorage("./my-storage")
	);
	hub.setStorage(simpleStorage);

	// Initialize nodes (e.g. load persistent messages from disk)
	await hub.init();

	return hub;
}

async function startWebsocketServer(hub: Hub): Promise<void> {
	// Create transports to the server, in this case a websocket server.
	// See `nodeserver.ts` for more examples, including https and plain TCP.
	// You can use the same `httpServer` for attaching to e.g. your Express API.
	// You can also use a custom path for the websocket.
	const httpServer = http.createServer();
	const wss = new ws.Server({ server: httpServer });

	let connectionId = 0;
	wss.on(
		"connection",
		(conn: ws) => new WSConnection(hub, conn, "websocket" + connectionId++)
	);

	const port = 13900;
	await new Promise((resolve, reject) => {
		wss.once("error", (err) => reject(err));
		httpServer.listen(port, (): void => {
			log.info(`WebSocket Server started on port ${port}`);
			resolve();
		});
	});
}

async function demoInternalConnection(hub: Hub): Promise<void> {
	// Create a local connection to the hub (i.e. not going through any
	// network connections etc), useful for any in-program exchanges to
	// the hub.
	// You can create as many as you like, and the API is just like your
	// normal networked client.
	const client = new LocalClient(hub, "local");
	client.on("message", (msg: Message, subscriptionId: string) => {
		log.info(
			`Received on ${subscriptionId} for ${msg.topic}: ${JSON.stringify(
				msg.data
			)}`
		);
	});

	await client.connect();
	await client.login("someUser", "somePassword");
	await client.subscribe("default", "/something/**", "default-something");
	await client.publish(
		"someNode",
		"/something/to/test",
		{ test: "data" },
		{ keep: true }
	);
	await client.close();
}

async function main(): Promise<void> {
	// Configure logging (optional)
	log.logLevel = LogLevel.Debug;
	log.onMessage = (msg: string) => {
		// This is already the default, but you can override it like this
		console.log(msg); // tslint:disable-line:no-console
	};

	const hub = await createHub();
	await startWebsocketServer(hub);

	await demoInternalConnection(hub);

	log.info("");
	log.info("Use `mhub-client -l` to see the published test message");
	log.info("using the websocket connection.");
	log.info("Press Ctrl-C to stop the server.");
}

function die(fmt: string, ...args: any[]): void {
	log.fatal(fmt, ...args);
	process.exit(1);
}

main().catch((err) => die("main crashed", err));
