/**
 * Tests for MHub client/server authentication/authorization.
 */

import LocalClient from "../src/localclient";
import Hub from "../src/hub";
import { Exchange } from "../src/nodes/exchange";
import { PlainAuthenticator } from "../src/authenticator";
import Promise from "ts-promise";

import { expect } from "chai";

import "./common";
import { Message } from "../src/message";

/**
 * Define subscription pattern, then a number of topics to publish,
 * and their expected outcome (whether they will end up in the
 * subscription or not).
 */
interface PubSubTestDefinition {
	[subscriptionPattern: string]: {
		[publishTopic: string]: boolean;
	};
}

describe("auth", (): void => {
	let hub: Hub;
	let auth: PlainAuthenticator;
	let client: LocalClient;

	function createAndConnectClient(): Promise<void> {
		client = new LocalClient(hub, "test");
		return client.connect();
	}

	beforeEach(() => {
		hub = new Hub();
		auth = new PlainAuthenticator();
		hub.setAuthenticator(auth);
		hub.add(new Exchange("default"));
		return createAndConnectClient();
	});

	function expectErrorContaining(p: Promise<void>, message: string): Promise<void> {
		return p.catch((err) => {
			expect(err.message).to.contain(message);
		});
	}

	function expectPermissionDenied(p: Promise<void>): Promise<void> {
		return expectErrorContaining(p, "permission denied");
	}

	function expectOk(p: Promise<void>): Promise<void> {
		// mainly for better documentation of the test
		return p;
	}

	function testDenyPublish(node: string = "default", topic: string = "topic"): void {
		it("deny publish", (): Promise<void> => {
			return expectPermissionDenied(client.publish(node, topic));
		});
		it("doesn't give away node existence when permission denied", (): Promise<void> => {
			let err1: Error;
			let err2: Error;
			return client.publish(node, topic)
				.catch((err) => err1 = err)
				.then(() => client.publish("nonexistent", topic))
				.catch((err) => err2 = err)
				.then(() => {
					expect(err1).to.be.instanceof(Error);
					expect(err2).to.be.instanceof(Error);
					expect(err1.message).to.contain("permission denied");
					expect(err1.message).to.equal(err2.message);
					expect(err1.name).to.equal(err2.name);
				});
		});

	}

	function testDenySubscribe(node: string = "default", pattern?: string): void {
		it("deny subscribe", (): Promise<void> => {
			return expectPermissionDenied(client.subscribe(node, pattern));
		});
	}

	function testAllowPublish(node: string = "default", topic: string = "topic"): void {
		it("allow publish", (): Promise<void> => {
			return expectOk(client.publish(node, topic));
		});
	}

	function testAllowSubscribe(node: string = "default", pattern?: string): void {
		it("allow subscribe", (): Promise<void> => {
			return expectOk(client.subscribe(node, pattern));
		});
	}

	// Create tests that: subscribe to each of the given subscription patterns, then
	// for each of these send a number of topics, and check whether they are/aren't
	// received by the subscription as expected.
	// Note: topics may be filtered by both the subscription pattern AND authorization
	// settings.
	function testSubscribePatterns(node: string, pubSubDefinition: PubSubTestDefinition): void {
		// tslint:disable-next-line:forin
		for (const subscriptionPattern in pubSubDefinition) {
			const publishTests = pubSubDefinition[subscriptionPattern];
			// tslint:disable-next-line:forin
			for (const publishTopic in publishTests) {
				const expectedResult = publishTests[publishTopic];
				it(`subscription to ${node}:${subscriptionPattern || "<no pattern>"} ${expectedResult ? "pass" : "filter"} ${publishTopic}`, () => {
					let msgs: Message[] = [];
					client.on("message", (msg: Message) => msgs.push(msg));
					return client.subscribe(node, subscriptionPattern)
						.then(() => {
							// Send message directly, bypassing any authentication
							// that may exist for 'normal' clients.
							hub.findDestination(node)!.send(new Message(publishTopic));
							// Make sure all internal processing has completed, and any
							// messages will have cleared queues.
							return Promise.delay(0);
						})
						.then(() => {
							if (expectedResult) {
								expect(msgs.length).to.equal(1, "expected message to be received");
								expect(msgs[0].topic).to.equal(publishTopic);
							} else {
								expect(msgs.length).to.equal(0, "expected message to not be received");
							}
						});
				});
			}
		}
	}

	describe("authentication", () => {
		beforeEach(() => {
			auth.setUser("foo", "bar");
		});

		it("allows plain login", (): Promise<void> => {
			return client.login("foo", "bar");
		});

		it("rejects incorrect user/pass", (): Promise<void> => {
			return expectErrorContaining(client.login("foo", "wrong"), "authentication failed");
		});

		it("rejects username starting with @", (): Promise<void> => {
			return expectErrorContaining(client.login("@foo", "bar"), "invalid username");
		});

		it("rejects empty username", (): Promise<void> => {
			return expectErrorContaining(client.login("", ""), "invalid username");
		});

		it("rejects double login", (): Promise<void> => {
			return expectErrorContaining(
				client.login("foo", "bar").then(() => client.login("foo", "bar")),
				"already logged in"
			);
		});
	});

	describe("unspecified anonymous rights", () => {
		beforeEach(() => {
			hub.setRights({});
			// Recreate client to re-load anonymous rights
			return createAndConnectClient();
		});
		testDenyPublish();
		testDenySubscribe();
	});

	describe("specified empty anonymous rights", () => {
		beforeEach(() => {
			hub.setRights({
				"": {},
			});
			// Recreate client to re-load anonymous rights
			return createAndConnectClient();
		});
		testDenyPublish();
		testDenySubscribe();
	});

	describe("specified permissive anonymous rights", () => {
		beforeEach(() => {
			hub.setRights({
				"": true,
			});
			// Recreate client to re-load anonymous rights
			return createAndConnectClient();
		});
		testAllowPublish();
		testAllowSubscribe();
	});

	describe("empty rights", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.setRights({
				"testUser": {
				},
			});
			return client.login("testUser", "");
		});
		testDenyPublish();
		testDenySubscribe();
	});

	describe("`false` rights", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.setRights({
				"testUser": false,
			});
			return client.login("testUser", "");
		});
		testDenyPublish();
		testDenySubscribe();
	});

	describe("`true` rights", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.setRights({
				"testUser": true,
			});
			return client.login("testUser", "");
		});
		testAllowPublish();
		testAllowSubscribe();
	});

	describe("only publish rights", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.setRights({
				"testUser": {
					publish: true,
				},
			});
			return client.login("testUser", "");
		});
		testAllowPublish();
		testDenySubscribe();
	});

	describe("only subscribe rights", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.setRights({
				"testUser": {
					subscribe: true,
				},
			});
			return client.login("testUser", "");
		});
		testDenyPublish();
		testAllowSubscribe();
	});

	describe("allow publish on a node", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					publish: {
						"someNode": true,
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenyPublish("default");
		testAllowPublish("someNode");
	});

	describe("deny publish on a node", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					publish: {
						"someNode": false,
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenyPublish("someNode");
	});

	describe("allow publish on a node+topic", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					publish: {
						"someNode": "/foo/bar/baz",
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenyPublish("someNode", "foo");
		testAllowPublish("someNode", "/foo/bar/baz");
		testDenyPublish("otherNode", "/foo/bar/baz");
	});

	describe("allow publish on a node+pattern", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					publish: {
						"someNode": "/foo/**",
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenyPublish("someNode", "foo");
		testAllowPublish("someNode", "/foo/bar/baz");
		testAllowPublish("someNode", "/foo/flep");
		testDenyPublish("otherNode", "/foo/bar/baz");
	});

	describe("allow publish on a node+multiple patterns", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					publish: {
						"someNode": ["test", "/foo/**"],
					},
				},
			});
			return client.login("testUser", "");
		});
		testAllowPublish("someNode", "test");
		testDenyPublish("someNode", "testfoo");
		testAllowPublish("someNode", "/foo/bar/baz");
		testDenyPublish("otherNode", "/foo/bar/baz");
	});

	describe("allow subscribe on a node", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					subscribe: {
						"someNode": true,
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenySubscribe("default");
		testAllowSubscribe("someNode");
		testAllowSubscribe("someNode", "**");
		testAllowSubscribe("someNode", "/foo/bar");
		testSubscribePatterns("someNode", {
			"": { "/foo/bar/baz": true },
			"*": { "/foo/bar/baz": false },
			"**": { "/foo/bar/baz": true },
			"/foo/bar/baz": {
				"/foo/bar/baz": true,
				"/foo/bar": false,
			},
			"/**/baz": {
				"/foo/bar/baz": true,
				"/foo/meh/baz": true,
				"/foo/bar": false,
			},
		});
	});

	describe("deny subscribe on a node", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					subscribe: {
						"someNode": false,
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenySubscribe("someNode");
		testDenySubscribe("someNode", "**");
		testDenySubscribe("someNode", "/foo/bar");
	});

	describe("allow subscribe on a node+topic", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					subscribe: {
						"someNode": "/foo/bar/baz",
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenySubscribe("otherNode");
		testDenySubscribe("otherNode", "**");
		testAllowSubscribe("someNode");
		testAllowSubscribe("someNode", "**");
		testAllowSubscribe("someNode", "/foo/bar/baz"); // special case: exact pattern match

		// Note: these two may fail in the future, if/when we can do pattern intersection
		testAllowSubscribe("someNode", "/foo/bar");
		testAllowSubscribe("someNode", "foo");

		testSubscribePatterns("someNode", {
			"": {
				"/foo/bar/baz": true,
				"/foo/bar/bazz": false,
				"/foo/bar": false,
			},
			"*": { "/foo/bar/baz": false },
			"**": { "/foo/bar/baz": true },
			"/foo/bar/baz": {
				"/foo/bar/baz": true,
				"/foo/bar": false,
			},
			"/**/baz": {
				"/foo/bar/baz": true,
				"/foo/meh/baz": false,
				"/foo/bar": false,
			},
		});
	});

	describe("allow subscribe on a node+pattern", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					subscribe: {
						"someNode": "/foo/**",
					},
				},
			});
			return client.login("testUser", "");
		});
		testDenySubscribe("otherNode");
		testDenySubscribe("otherNode", "**");

		testAllowSubscribe("someNode");
		testAllowSubscribe("someNode", "**");
		testAllowSubscribe("someNode", "/foo/**"); // special case: exact pattern match
		testAllowSubscribe("someNode", "/foo/bar/baz");

		// Note: these two may fail in the future, if/when we can do pattern intersection
		testAllowSubscribe("someNode", "/foo");
		testAllowSubscribe("someNode", "foo");

		testSubscribePatterns("someNode", {
			"": {
				"/foo/bar/baz": true,
				"/foo/bar/bazz": true,
				"/foo/bar": true,
				"/foo/": true,
				"/foo": false,
				"foo": false,
			},
			"*": {
				"/foo/bar/baz": false,
				"/foo": false,
			},
			"**": {
				"/foo/bar/baz": true,
				"/foo": false,
			},
			"/foo/bar/baz": {
				"/foo/bar/baz": true,
				"/foo/bar": false,
			},
			"/**/baz": {
				"/foo/bar/baz": true,
				"/foo/meh/baz": true,
				"/meh/foo/baz": false,
				"/foo/bar": false,
			},
		});
	});

	describe("allow subscribe on a node+multiple patterns", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.add(new Exchange("someNode"));
			hub.setRights({
				"testUser": {
					subscribe: {
						"someNode": ["test", "/foo/**"],
					},
				},
			});
			return client.login("testUser", "");
		});
		testAllowSubscribe("someNode", "foo");
		testDenySubscribe("someNode", "foobar");
		testAllowSubscribe("someNode", "/foo/bar/baz");
		testAllowSubscribe("someNode", "test");
		testDenySubscribe("otherNode", "/foo/bar/baz");
		testSubscribePatterns("someNode", {
			"": {
				"/foo/bar/baz": true,
				"/foo/bar/bazz": true,
				"/foo/bar": true,
				"/foo/": true,
				"/foo": false,
				"foo": false,
				"test": true,
			},
			"*": {
				"/foo/bar/baz": false,
				"/foo": false,
				"test": true,
			},
			"**": {
				"/foo/bar/baz": true,
				"/foo": false,
				"test": true,
			},
			"/foo/bar/baz": {
				"/foo/bar/baz": true,
				"/foo/bar": false,
				"test": false,
			},
			"/**/baz": {
				"/foo/bar/baz": true,
				"/foo/meh/baz": true,
				"/meh/foo/baz": false,
				"/foo/bar": false,
				"test": false,
			},
		});
	});

	describe("pubsub", () => {
		beforeEach((): Promise<void> => {
			auth.setUser("testUser", "");
			hub.setRights({
				"testUser": true,
			});
			return client.login("testUser", "");
		});

		it("can receive everything", () => {
			let msgs: Message[] = [];
			return client.subscribe("default")
				.then(() => client.on("message", (msg: Message) => msgs.push(msg)))
				.then(() => client.publish("default", "/foo/bar/baz"))
				.then(() => client.publish("default", "/bar"))
				.then(() => {
					expect(msgs).to.deep.equal([
						new Message("/foo/bar/baz", undefined, {}),
						new Message("/bar", undefined, {}),
					]);
				});
		});

		it("can filter on a topic", () => {
			let msgs: Message[] = [];
			return client.subscribe("default", "/bar")
				.then(() => client.on("message", (msg: Message) => msgs.push(msg)))
				.then(() => client.publish("default", "/foo/bar/baz"))
				.then(() => client.publish("default", "/bar"))
				.then(() => {
					expect(msgs).to.deep.equal([new Message("/bar", undefined, {})]);
				});
		});
	});
});
