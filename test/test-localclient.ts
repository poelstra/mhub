/**
 * Tests of LocalClient.
 *
 * This basically only tests the connection logic to the Hub,
 * as the full API is part of BaseClient.
 */

import { expect } from "chai";
import Promise from "ts-promise";

import Hub from "../src/hub";
import { LocalClient } from "../src/localclient";
import Message from "../src/message";
import Exchange from "../src/nodes/exchange";

function createHub(): Hub {
	const hub = new Hub();
	hub.setRights({ "": true });
	hub.add(new Exchange("default"));
	return hub;
}

describe("LocalClient", () => {
	it("supports basic operations", () => {
		const hub = createHub();
		const client = new LocalClient(hub, "test");
		let received: Message;
		client.on("message", (msg: Message) => received = msg);
		return Promise.resolve()
			.then(() => client.connect())
			.then(() => client.subscribe("default"))
			.then(() => client.publish("default", "a"))
			.then(() => expect(received.topic).to.equal("a"))
			.then(() => client.close());
	});

	it("supports reconnect", () => {
		const hub = createHub();
		const client = new LocalClient(hub, "test");
		let received: Message;
		client.on("message", (msg: Message) => received = msg);
		return Promise.resolve()
			.then(() => client.connect())
			.then(() => client.publish("default", "a"))
			.then(() => client.close())
			.then(() => client.connect())
			.then(() => client.subscribe("default"))
			.then(() => client.publish("default", "b"))
			.then(() => expect(received.topic).to.equal("b"))
			.then(() => client.close());
	});
});
