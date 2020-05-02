/**
 * Tests for MHub publish / subscribe logic.
 */

import { expect } from "chai";

import { PlainAuthenticator } from "../src/authenticator";
import Hub from "../src/hub";
import LocalClient from "../src/localclient";
import { Message } from "../src/message";
import { Exchange } from "../src/nodes/exchange";

import "./common";

describe("hub", (): void => {
	let hub: Hub;
	let client: LocalClient;

	function createAndConnectClient(): Promise<void> {
		client = new LocalClient(hub, "test");
		return client.connect();
	}

	beforeEach(() => {
		const auth = new PlainAuthenticator();
		hub = new Hub(auth);
		hub.add(new Exchange("default"));
		hub.setRights({
			"": true,
		});
		return createAndConnectClient();
	});

	afterEach(() => client.close());

	describe("subscribe", () => {
		let msgs: { [id: string]: Message[] };

		beforeEach(() => {
			client.on("message", (msg: Message, id: string) => {
				if (!msgs[id]) {
					msgs[id] = [];
				}
				msgs[id].push(msg);
			});
			msgs = {};
		});

		it("receives everything", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [
							new Message("/nee/nee", undefined, {}),
							new Message("/ja/ja", undefined, {}),
						],
					});
				});
		});

		it("receives everything explicitly", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "**"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [
							new Message("/nee/nee", undefined, {}),
							new Message("/ja/ja", undefined, {}),
						],
					});
				});
		});

		it("filters on a topic", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "/ja/ja"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [new Message("/ja/ja", undefined, {})],
					});
				});
		});

		it("receives once for multiple identical subscribes", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "/ja/ja"))
				.then(() => client.subscribe("default", "/ja/ja")) // second time
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [new Message("/ja/ja", undefined, {})],
					});
				});
		});

		it("receives once for multiple overlapping subscribes", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "/ja/ja"))
				.then(() => client.subscribe("default", "/ja**"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [new Message("/ja/ja", undefined, {})],
					});
				});
		});

		it("receives twice for multiple identical subscribes using different IDs", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "/ja/ja", "id1"))
				.then(() => client.subscribe("default", "/ja/ja", "id2"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						id1: [new Message("/ja/ja", undefined, {})],
						id2: [new Message("/ja/ja", undefined, {})],
					});
				});
		});
	});

	describe("unsubscribe", () => {
		let msgs: { [id: string]: Message[] };

		beforeEach(() => {
			client.on("message", (msg: Message, id: string) => {
				if (!msgs[id]) {
					msgs[id] = [];
				}
				msgs[id].push(msg);
			});
			msgs = {};
		});

		it("unsubscribes everything on given node with default id", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default"))
				.then(() => client.subscribe("default", undefined, "id1"))
				.then(() => client.unsubscribe("default"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						id1: [
							new Message("/nee/nee", undefined, {}),
							new Message("/ja/ja", undefined, {}),
						],
					});
				});
		});

		it("unsubscribes everything on given node with custom id", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", undefined, "id1"))
				.then(() => client.subscribe("default", undefined, "id2"))
				.then(() => client.unsubscribe("default", undefined, "id1"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						id2: [
							new Message("/nee/nee", undefined, {}),
							new Message("/ja/ja", undefined, {}),
						],
					});
				});
		});

		it("ignores unsubscribe on unknown id", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", undefined, "id1"))
				.then(() => client.unsubscribe("default", undefined, "id2"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						id1: [
							new Message("/nee/nee", undefined, {}),
							new Message("/ja/ja", undefined, {}),
						],
					});
				});
		});

		it("ignores unsubscribe on unknown pattern", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", undefined))
				.then(() => client.unsubscribe("default", "/nee/**"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [
							new Message("/nee/nee", undefined, {}),
							new Message("/ja/ja", undefined, {}),
						],
					});
				});
		});

		it("handles explicit unsubscribe of '**'", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "**"))
				.then(() => client.subscribe("default", "/ja/ja"))
				.then(() => client.unsubscribe("default", "**"))
				.then(() => client.publish("default", "/nee/nee"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({
						default: [new Message("/ja/ja", undefined, {})],
					});
				});
		});

		it("unsubscribes double-subscribes as expected", () => {
			return Promise.resolve()
				.then(() => client.subscribe("default", "/ja/ja"))
				.then(() => client.subscribe("default", "/ja/ja")) // second time
				.then(() => client.unsubscribe("default", "/ja/ja"))
				.then(() => client.publish("default", "/ja/ja"))
				.then(() => {
					expect(msgs).to.deep.equal({});
				});
		});
	});
});
