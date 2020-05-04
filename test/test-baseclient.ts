/**
 * Tests of BaseClient.
 *
 * Tests (transport-agnostic) protocol handling of client against server.
 */

import * as chai from "chai";
import { expect } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { EventEmitter } from "ws";
import BaseClient, { Connection, MAX_SEQ } from "../src/baseclient";
import * as protocol from "../src/protocol";
import { setImmediate } from "timers";

chai.use(chaiAsPromised);

interface Request {
	command: protocol.Command;
}

interface Response {
	command: protocol.Command;
	response: protocol.Response;
}

class FakeConnection extends EventEmitter implements Connection {
	private _requests: Request[] = [];
	private _responses: Response[] = [];

	public closed: boolean = false;

	constructor() {
		super();
		Promise.resolve().then(() => {
			// We're a direct connection, so immediately connected.
			// However, need to defer it a bit, because our creator
			// needs to attach the event handler.
			this.emit("open");
		});
	}

	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	public async send(data: protocol.Command): Promise<void> {
		this._requests.push({
			command: data,
		});
		this._flush();
	}

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async close(): Promise<void> {
		this.closed = true;
		this.emit("close");
	}

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async terminate(): Promise<void> {
		this.closed = true;
	}

	async expectAndReply(
		command: protocol.Command,
		response: protocol.Response
	): Promise<void> {
		this._responses.push({
			command,
			response,
		});
		this._flush();
	}

	public assertEmpty() {
		expect([]).to.deep.equal(
			this._responses.map((r) => r.command),
			"not all expected commands came in"
		);
		expect([]).to.deep.equal(
			this._requests.map((r) => r.command),
			"not all commands have been processed"
		);
	}

	private _flush(): void {
		while (this._requests.length > 0 && this._responses.length > 0) {
			const req = this._requests.shift()!;
			const res = this._responses.shift()!;

			try {
				expect(req.command).to.deep.equal(
					res.command,
					"unexpected command received"
				);
				this.emit("message", res.response);
			} catch (e) {
				// Ensure that any assertion failure is captured
				// directly, not swallowed internally in the client
				setImmediate(() => {
					throw e;
				});
			}
		}
	}
}

describe("BaseClient", () => {
	let connection: FakeConnection;
	let client: BaseClient;

	beforeEach(async () => {
		connection = new FakeConnection();
		client = new BaseClient(() => connection);
		await client.connect();
	});

	afterEach(async () => {
		await client.close();
		connection.assertEmpty();
	});

	describe("sequence numbers", () => {
		it("should increase sequence numbers", async () => {
			connection.expectAndReply(
				{
					type: "ping",
					seq: 0,
				},
				{ type: "pingack", seq: 0 }
			);
			connection.expectAndReply(
				{
					type: "ping",
					seq: 1,
				},
				{ type: "pingack", seq: 1 }
			);
			await client.ping();
			await client.ping();
		});

		it("should handle out-of-order responses");

		it("should wrap around", async () => {
			// Generate packets for 0..65535
			for (let i = 0; i < MAX_SEQ; i++) {
				connection.expectAndReply(
					{
						type: "ping",
						seq: i,
					},
					{ type: "pingack", seq: i }
				);
				await client.ping();
			}
			// Two more 'normal' ones
			connection.expectAndReply(
				{
					type: "ping",
					seq: 0,
				},
				{ type: "pingack", seq: 0 }
			);
			await client.ping();
			connection.expectAndReply(
				{
					type: "ping",
					seq: 1,
				},
				{ type: "pingack", seq: 1 }
			);
			await client.ping();
		}).timeout(10000);
	});

	describe("#connect", () => {
		it("should connect");
		it("should connect after disconnect");
		it("should handle connect error");
		it("should handle simultaneous connect");
	});

	describe("#close", () => {
		it("should close gracefully");
		it("should close forcefully");
		it("should handle simultaneous close");
	});

	describe("#login", () => {
		it("sends login", async () => {
			connection.expectAndReply(
				{
					type: "login",
					username: "myUser",
					password: "myPass",
					seq: 0,
				},
				{ type: "loginack", seq: 0 }
			);
			await client.login("myUser", "myPass");
		});

		it("handles error", async () => {
			connection.expectAndReply(
				{
					type: "login",
					username: "myUser",
					password: "badPass",
					seq: 0,
				},
				{ type: "error", message: "some error", seq: 0 }
			);
			await expect(client.login("myUser", "badPass")).to.be.rejectedWith(
				"some error"
			);
		});
	});

	describe("#subscribe", () => {
		it("TODO");
	});

	describe("#unsubscribe", () => {
		it("TODO");
	});

	describe("#publish", () => {
		it("publishes without data and headers", async () => {
			connection.expectAndReply(
				{
					type: "publish",
					node: "myNode",
					topic: "myTopic",
					data: undefined,
					headers: {},
					seq: 0,
				},
				{ type: "puback", seq: 0 }
			);
			await client.publish("myNode", "myTopic");
		});

		it("publishes with data and headers", async () => {
			connection.expectAndReply(
				{
					type: "publish",
					node: "myNode",
					topic: "myTopic",
					data: "myData",
					headers: { a: "b" },
					seq: 0,
				},
				{ type: "puback", seq: 0 }
			);
			await client.publish("myNode", "myTopic", "myData", { a: "b" });
		});

		it("handles error", async () => {
			connection.expectAndReply(
				{
					type: "publish",
					node: "myNode",
					topic: "myTopic",
					data: undefined,
					headers: {},
					seq: 0,
				},
				{ type: "error", message: "some error", seq: 0 }
			);
			await expect(
				client.publish("myNode", "myTopic")
			).to.be.rejectedWith("some error");
		});
	});

	describe("#ping", () => {
		it("should ping", async () => {
			connection.expectAndReply(
				{
					type: "ping",
					seq: 0,
				},
				{ type: "pingack", seq: 0 }
			);
			await client.ping();
		});

		it("should handle timeout");
	});

	describe("keepalive", () => {
		it("should poll in background");
		it("should close connection after ping timeout");
		it("should not cause double error when ping failed due to disconnect");
	});
});
