/**
 * Tests for HubClient.
 */

import HubClient from "../src/hubclient";
import Hub from "../src/hub";
import * as protocol from "../src/protocol";
import { PlainAuthenticator } from "../src/authenticator";

import { expect } from "chai";

import "./common";

describe("HubClient", (): void => {
	let client: HubClient;

	beforeEach(() => {
		const auth = new PlainAuthenticator();
		auth.setUser("foo", "bar");
		const hub = new Hub();
		hub.setAuthenticator(auth);
		client = new HubClient(hub, "testclient");
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
});
