/**
 * Tests for HubClient.
 */

import { expect } from "chai";
import { once } from "events";

import { PlainAuthenticator } from "../src/authenticator";
import Hub from "../src/hub";
import HubClient from "../src/hubclient";
import Exchange from "../src/nodes/exchange";
import * as protocol from "../src/protocol";

import "./common";

function waitFor<T extends protocol.Response>(
	client: HubClient,
	type: T["type"]
): Promise<T> {
	return new Promise((resolve) => {
		const handler = (response: protocol.Response) => {
			if (response.type === type) {
				resolve(response as T);
				client.off("response", handler);
			}
		};
		client.on("response", handler);
	});
}

async function invoke<T extends protocol.Response>(
	client: HubClient,
	command: protocol.Command,
	responseType: T["type"]
): Promise<T>;
async function invoke<T extends protocol.Response>(
	client: HubClient,
	command: protocol.Command
): Promise<protocol.Response>;
async function invoke<T extends protocol.Response>(
	client: HubClient,
	command: protocol.Command,
	responseType?: T["type"]
): Promise<T> {
	if (responseType) {
		const response = waitFor(client, responseType);
		await client.processCommand(command);
		return response;
	} else {
		const response = once(client, "response");
		await client.processCommand(command);
		return (await response)[0];
	}
}

describe("HubClient", (): void => {
	let hub: Hub;
	let auth: PlainAuthenticator;
	let client: HubClient;

	beforeEach(() => {
		auth = new PlainAuthenticator();
		hub = new Hub(auth);
		hub.add(new Exchange("default"));

		// Need to create client later, because some tests want to set
		// different rights and otherwise authorizer for anonymous will
		// already be assigned.
		client = undefined as any;
	});

	describe("#processCommand", () => {
		beforeEach(() => {
			hub.setRights({ "": true });
			client = new HubClient(hub, "testclient");
		});

		it("handles invalid input (undefined)", async () => {
			await invoke(client, <any>undefined, "error");
		});

		it("handles invalid input (not an object)", async () => {
			await invoke(client, <any>true, "error");
		});

		it("handles invalid input (missing type)", async () => {
			await invoke(client, <any>{}, "error");
		});

		it("handles invalid input (invalid type)", async () => {
			await invoke(client, <any>{ type: "foo" }, "error");
		});
	});

	describe("#login", () => {
		beforeEach(() => {
			auth.setUser("foo", "bar");
			client = new HubClient(hub, "testclient");
		});

		it("allows plain login", async () => {
			await invoke(
				client,
				{
					type: "login",
					seq: 0,
					username: "foo",
					password: "bar",
				},
				"loginack"
			);
		});

		it("rejects invalid user/pass", async () => {
			await invoke(
				client,
				{
					type: "login",
					seq: 0,
					username: "foo",
					password: "baz",
				},
				"error"
			);
		});
	});

	describe("#publish", () => {
		beforeEach(() => {
			auth.setUser("foo", "bar");
			hub.setRights({
				"": { publish: false, subscribe: true },
				foo: { publish: true, subscribe: true },
			});
			client = new HubClient(hub, "testclient");
		});

		it("disallows (anonymous) publish when configured", async () => {
			const res = await invoke(client, {
				type: "publish",
				seq: 0,
				node: "default",
				topic: "test",
			});
			expect(res.type).to.equal("error");
			expect((<protocol.ErrorResponse>res).message).to.contain(
				"permission denied"
			);
		});

		it("allows publish when configured", async () => {
			await invoke(
				client,
				{
					type: "login",
					seq: 0,
					username: "foo",
					password: "bar",
				},
				"loginack"
			);

			await invoke(
				client,
				{
					type: "publish",
					seq: 1,
					node: "default",
					topic: "test",
				},
				"puback"
			);
		});
	});
});
