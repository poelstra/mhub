/**
 * Tests for HubClient.
 */

import HubClient from "../src/hubclient";
import Hub from "../src/hub";
import * as protocol from "../src/protocol";
import { PlainAuthenticator } from "../src/authenticator";
import Exchange from "../src/nodes/exchange";

import { expect } from "chai";

import "./common";

describe("HubClient", (): void => {
	let client: HubClient;

	beforeEach(() => {
		const hub = new Hub();

		const auth = new PlainAuthenticator();
		auth.setUser("foo", "bar");
		hub.setAuthenticator(auth);

		hub.setRights({
			"": { publish: false, subscribe: true },
			"foo": { publish: true, subscribe: true },
		});

		hub.add(new Exchange("default"));

		client = new HubClient(hub, "testclient");
	});

	describe("#processCommand", () => {
		it("handles invalid input (undefined)", (done: MochaDone) => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("error");
				done();
			});
			client.processCommand(<any>undefined);
		});

		it("handles invalid input (not an object)", (done: MochaDone) => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("error");
				done();
			});
			client.processCommand(<any>true);
		});

		it("handles invalid input (missing type)", (done: MochaDone) => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("error");
				done();
			});
			client.processCommand(<any>{});
		});

		it("handles invalid input (invalid type)", (done: MochaDone) => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("error");
				done();
			});
			client.processCommand(<any>{ type: "foo" });
		});
	});

	describe("#login", () => {
		it("allows plain login", (done: MochaDone): void => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("loginack");
				done();
			});
			client.processCommand({
				type: "login",
				seq: 0,
				username: "foo",
				password: "bar",
			});
		});

		it("rejects invalid user/pass", (done: MochaDone): void => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("error");
				done();
			});
			client.processCommand({
				type: "login",
				seq: 0,
				username: "foo",
				password: "baz",
			});
		});
	});

	describe("#publish", () => {
		it("disallows (anonymous) publish when configured", (done: MochaDone) => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("error");
				expect((<protocol.ErrorResponse>res).message).to.contain("permission denied");
				done();
			});
			client.processCommand({
				type: "publish",
				seq: 0,
				node: "default",
				topic: "test",
			});
		});

		it("allows publish when configured", (done: MochaDone) => {
			client.once("response", (res: protocol.Response) => {
				expect(res.type).to.equal("loginack");
				client.once("response", (res2: protocol.Response) => {
					expect(res2.type).to.equal("puback");
					done();
				});
				client.processCommand({
					type: "publish",
					seq: 0,
					node: "default",
					topic: "test",
				});
			});
			client.processCommand({
				type: "login",
				seq: 0,
				username: "foo",
				password: "bar",
			});
		});
	});
});
