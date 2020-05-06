/**
 * Tests of BaseClient.
 *
 * Tests (transport-agnostic) protocol handling of client against server.
 */

import * as chai from "chai";
import { expect } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";
import { setImmediate } from "timers";
import { EventEmitter } from "ws";
import BaseClient, {
	Connection,
	MAX_SEQ,
	defaultBaseClientOptions,
} from "../src/baseclient";
import Message from "../src/message";
import * as protocol from "../src/protocol";
import { swallowError } from "../src/util";

chai.use(sinonChai);
chai.use(chaiAsPromised);

// Chai promotes style like `expect(...).to.have.been.called;`
// tslint:disable: no-unused-expression

const never = new Promise<never>(() => {
	/* no op */
});

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

	public connected: boolean = false;

	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	public async send(data: protocol.Command): Promise<void> {
		expect(this.connected).to.equal(true);
		this._requests.push({
			command: data,
		});
		this._flush();
	}

	public async open(): Promise<void> {
		this.connected = true;
	}

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async close(): Promise<void> {
		this.connected = false;
	}

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async terminate(): Promise<void> {
		this.connected = false;
	}

	public expectAndReply(
		command: protocol.Command,
		response: protocol.Response
	): void {
		this._responses.push({
			command,
			response,
		});
		this._flush();
	}

	public popRequest(): protocol.Command | undefined {
		return this._requests.shift()?.command;
	}

	public emitResponse(response: protocol.Response): void {
		this.emit("message", response);
	}

	public emitMessage(subscription: string, message: Message): void {
		this.emitResponse({
			type: "message",
			topic: message.topic,
			data: message.data,
			headers: message.headers,
			subscription,
		});
	}

	public emitError(error: Error): void {
		this.emit("error", error);
	}

	public emitClose(): void {
		this.emit("close");
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
				this.emitResponse(res.response);
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
		client = new BaseClient(connection);
	});

	afterEach(async () => {
		await client.terminate();
		connection.assertEmpty();
	});

	describe("sequence numbers", () => {
		beforeEach(() => client.connect());

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

		it("should handle out-of-order responses", async () => {
			let done = false;
			const firstRequest = client.ping().then(() => (done = true));
			connection.popRequest();

			connection.expectAndReply(
				{
					type: "publish",
					node: "node",
					topic: "topic",
					data: undefined,
					headers: {},
					seq: 1,
				},
				{ type: "puback", seq: 1 }
			);
			await client.publish("node", "topic");
			expect(done).to.equal(false);

			connection.emitResponse({ type: "pingack", seq: 0 });
			await firstRequest;
		});

		it("should wrap around", async () => {
			// Keep first request 'occupied'
			const firstPing = client.ping();
			connection.popRequest();

			const startSeq = MAX_SEQ - 3;
			(client as any)._seqNo = startSeq;
			for (let i = startSeq; i < MAX_SEQ; i++) {
				connection.expectAndReply(
					{
						type: "ping",
						seq: i,
					},
					{ type: "pingack", seq: i }
				);
				await client.ping();
			}

			// One more, should wrap-around, but skip 0 because it's in-use
			connection.expectAndReply(
				{
					type: "ping",
					seq: 1,
				},
				{ type: "pingack", seq: 1 }
			);
			await client.ping();

			// Answer 0
			connection.emitResponse({ type: "pingack", seq: 0 });
			await firstPing;

			// Next request should still use 2
			connection.expectAndReply(
				{
					type: "ping",
					seq: 2,
				},
				{ type: "pingack", seq: 2 }
			);
			await client.ping();
		});
	});

	describe("#connect", () => {
		it("should connect", async () => {
			const open = sinon.spy(connection, "open");
			const onOpen = sinon.spy();
			client.on("open", onOpen);
			await client.connect();
			expect(open).to.be.calledOnceWithExactly();
			expect(onOpen).to.be.calledOnceWithExactly();
		});

		it("should merge simultaneous connects", async () => {
			const open = sinon.spy(connection, "open");
			const onOpen = sinon.spy();
			client.on("open", onOpen);
			const connect1 = client.connect();
			const connect2 = client.connect();
			await Promise.all([connect1, connect2]);
			expect(open).to.be.calledOnceWithExactly();
			expect(onOpen).to.be.calledOnceWithExactly();
		});

		it("should allow connect when already connected", async () => {
			const open = sinon.spy(connection, "open");
			const onOpen = sinon.spy();
			client.on("open", onOpen);
			await client.connect();
			await client.connect();
			expect(open).to.be.calledOnceWithExactly();
			expect(onOpen).to.be.calledOnceWithExactly();
		});

		it("should connect after disconnect", async () => {
			await client.connect();
			client.close(); // don't await

			const open = sinon.spy(connection, "open");
			const onOpen = sinon.spy();
			const onClose = sinon.spy();
			client.on("open", onOpen);
			client.on("close", onClose);
			await client.connect();
			expect(onClose).to.be.calledOnceWithExactly();
			expect(open).to.be.calledOnceWithExactly();
			expect(onClose).to.be.calledBefore(onOpen);
			expect(onOpen).to.be.calledOnceWithExactly();
		});

		it("should handle connect error", async () => {
			const error = new Error("foo");
			sinon.stub(connection, "open").throws(error);
			const onOpen = sinon.spy();
			const onError = sinon.spy();
			const onClose = sinon.spy();
			client.on("open", onOpen);
			client.on("error", onError);
			client.on("close", onClose);
			await expect(client.connect()).to.be.rejectedWith(error);
			expect(onOpen).to.not.be.called;
			expect(onClose).to.not.be.called;
			expect(onError).to.not.be.called;
		});

		it("should reject when closed while connecting", async () => {
			sinon.stub(connection, "open").returns(never);
			const connectPromise = client.connect();
			const close = sinon.spy(connection, "close");
			const terminate = sinon.spy(connection, "terminate");
			const onClose = sinon.spy();
			client.on("close", onClose);

			await client.close();
			expect(close).not.to.be.called;
			expect(terminate).to.be.calledOnceWithExactly();
			expect(onClose).not.to.be.called;
			await expect(connectPromise).to.be.rejectedWith(Error);
		});
	});

	describe("#close", () => {
		it("should ignore when already closed", async () => {
			const close = sinon.spy(connection, "close");
			const onClose = sinon.spy();
			client.on("close", onClose);
			await client.close();
			await client.close();
			expect(close).to.not.be.called;
			expect(onClose).to.not.be.called;
		});

		it("should wait for pending transactions to complete", async () => {
			await client.connect();
			const close = sinon.spy(connection, "close");
			const onClose = sinon.spy();
			client.on("close", onClose);

			const pingPromise = client.ping();
			const closePromise = client.close();
			await Promise.resolve();
			expect(close).to.not.be.called;

			connection.expectAndReply(
				{ type: "ping", seq: 0 },
				{ type: "pingack", seq: 0 }
			);
			await pingPromise;
			await closePromise;
			expect(onClose).to.be.called;
		});

		it("should reject new transactions", async () => {
			const close = sinon.spy(connection, "close");

			await client.connect();
			client.ping().catch(swallowError); // will be rejected when client is terminated
			connection.popRequest(); // don't answer the ping
			client.close().catch(swallowError);
			await expect(client.ping()).to.be.rejectedWith(
				Error,
				"not connected"
			);
			expect(close).to.not.be.called;
		});

		it("should handle simultaneous close", async () => {
			await client.connect();
			const close = sinon.spy(connection, "close");
			const onClose = sinon.spy();
			client.on("close", onClose);

			const close1 = client.close();
			const close2 = client.close();
			await Promise.all([close1, close2]);
			expect(close).to.be.calledOnceWithExactly();
			expect(onClose).to.be.calledOnceWithExactly();
		});

		it("should abort connect and not emit close event", async () => {
			sinon.stub(connection, "open").returns(never);
			client.connect().catch(swallowError);
			const close = sinon.spy(connection, "close");
			const terminate = sinon.spy(connection, "terminate");
			const onClose = sinon.spy();
			client.on("close", onClose);

			await client.close();
			expect(close).not.to.be.called;
			expect(terminate).to.be.calledOnceWithExactly();
			expect(onClose).not.to.be.called;
		});
	});

	describe("#terminate", () => {
		it("should ignore when already closed", async () => {
			const close = sinon.spy(connection, "close");
			const onClose = sinon.spy();
			client.on("close", onClose);
			await client.terminate();
			await client.terminate();
			expect(close).to.not.be.called;
			expect(onClose).to.not.be.called;
		});

		it("should abort pending transactions with generic error when aborted without error", async () => {
			await client.connect();
			const terminate = sinon.spy(connection, "terminate");
			const onClose = sinon.spy();
			client.on("close", onClose);
			const onError = sinon.spy();
			client.on("error", onError);

			const pingPromise = client.ping();
			connection.popRequest(); // don't answer ping

			await client.terminate();
			expect(terminate).to.be.called;
			await expect(pingPromise).to.be.rejectedWith(
				"connection terminated"
			);
			expect(onClose).to.be.called;
			expect(onError).not.to.be.called;
		});

		it("should abort pending transactions with error when aborted error", async () => {
			await client.connect();
			const terminate = sinon.spy(connection, "terminate");
			const onClose = sinon.spy();
			client.on("close", onClose);
			const onError = sinon.spy();
			client.on("error", onError);

			const pingPromise = client.ping();
			connection.popRequest(); // don't answer the ping

			const error = new Error("boom");
			await client.terminate(error);
			expect(terminate).to.be.called;
			await expect(pingPromise).to.be.rejectedWith("boom");
			expect(onClose).to.be.called;
			expect(onError).to.be.calledOnceWithExactly(error);
		});

		it("should reject new transactions", async () => {
			const close = sinon.spy(connection, "close");

			await client.connect();
			client.ping().catch(swallowError);
			connection.popRequest(); // don't answer the ping
			client.terminate();
			await expect(client.ping()).to.be.rejectedWith(
				Error,
				"not connected"
			);
			expect(close).to.not.be.called;
		});

		it("should handle simultaneous terminate", async () => {
			await client.connect();
			const terminate = sinon.spy(connection, "terminate");
			const onClose = sinon.spy();
			client.on("close", onClose);

			const terminate1 = client.terminate();
			const terminate2 = client.terminate();
			await Promise.all([terminate1, terminate2]);
			expect(terminate).to.be.calledOnceWithExactly();
			expect(onClose).to.be.calledOnceWithExactly();
		});

		it("should abort connect and not emit close event", async () => {
			sinon.stub(connection, "open").returns(never);
			client.connect().catch(swallowError);
			const close = sinon.spy(connection, "close");
			const terminate = sinon.spy(connection, "terminate");
			const onClose = sinon.spy();
			client.on("close", onClose);

			await client.terminate();
			expect(close).not.to.be.called;
			expect(terminate).to.be.calledOnceWithExactly();
			expect(onClose).not.to.be.called;
		});

		it("should abort pending close", async () => {
			await client.connect();
			const close = sinon.spy(connection, "close");
			const onClose = sinon.spy();
			client.on("close", onClose);

			client.ping().catch(swallowError);
			connection.popRequest();

			const closePromise = client.close();
			await Promise.resolve();
			expect(close).to.not.be.called;

			client.terminate();
			await expect(closePromise).to.be.rejectedWith(
				Error,
				"connection terminated"
			);
			expect(onClose).to.be.called;
		});
	});

	describe("#login", () => {
		beforeEach(() => client.connect());

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
		beforeEach(() => client.connect());

		it("subscribes without topic and id", async () => {
			connection.expectAndReply(
				{
					type: "subscribe",
					node: "myNode",
					pattern: undefined,
					id: undefined,
					seq: 0,
				},
				{ type: "suback", seq: 0 }
			);
			await client.subscribe("myNode");
		});

		it("subscribes with topic and id", async () => {
			connection.expectAndReply(
				{
					type: "subscribe",
					node: "myNode",
					pattern: "myTopic/**",
					id: "myId",
					seq: 0,
				},
				{ type: "suback", seq: 0 }
			);
			await client.subscribe("myNode", "myTopic/**", "myId");
		});

		it("handles error", async () => {
			connection.expectAndReply(
				{
					type: "subscribe",
					node: "myNode",
					pattern: undefined,
					id: undefined,
					seq: 0,
				},
				{ type: "error", message: "some error", seq: 0 }
			);
			await expect(client.subscribe("myNode")).to.be.rejectedWith(
				"some error"
			);
		});
	});

	describe("#unsubscribe", () => {
		beforeEach(() => client.connect());

		it("unsubscribes without topic and id", async () => {
			connection.expectAndReply(
				{
					type: "unsubscribe",
					node: "myNode",
					pattern: undefined,
					id: undefined,
					seq: 0,
				},
				{ type: "unsuback", seq: 0 }
			);
			await client.unsubscribe("myNode");
		});

		it("unsubscribes with topic and id", async () => {
			connection.expectAndReply(
				{
					type: "unsubscribe",
					node: "myNode",
					pattern: "myTopic/**",
					id: "myId",
					seq: 0,
				},
				{ type: "unsuback", seq: 0 }
			);
			await client.unsubscribe("myNode", "myTopic/**", "myId");
		});

		it("handles error", async () => {
			connection.expectAndReply(
				{
					type: "unsubscribe",
					node: "myNode",
					pattern: undefined,
					id: undefined,
					seq: 0,
				},
				{ type: "error", message: "some error", seq: 0 }
			);
			await expect(client.unsubscribe("myNode")).to.be.rejectedWith(
				"some error"
			);
		});
	});

	describe("#publish", () => {
		beforeEach(() => client.connect());

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
		let clock: sinon.SinonFakeTimers;
		beforeEach(() => (clock = sinon.useFakeTimers()));
		afterEach(() => clock?.restore());

		beforeEach(() => client.connect());

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

		it("should handle timeout", async () => {
			let timedout: Error | undefined;
			client.ping(1000).catch((err) => (timedout = err));
			connection.popRequest(); // let it timeout
			await clock.tickAsync(999);
			expect(timedout).to.be.undefined;
			await clock.tickAsync(1);
			expect(timedout)
				.to.be.instanceOf(Error)
				.and.property("message")
				.to.contain("timeout");
		});
	});

	describe("keepalive", () => {
		let clock: sinon.SinonFakeTimers;
		beforeEach(() => (clock = sinon.useFakeTimers()));
		afterEach(() => clock?.restore());

		beforeEach(() => client.connect());

		it("should poll in background while connected", async () => {
			await clock.tickAsync(defaultBaseClientOptions.keepalive! - 1);
			expect(connection.popRequest()).to.be.undefined;
			await clock.tickAsync(1);
			connection.expectAndReply(
				{ type: "ping", seq: 0 },
				{ type: "pingack", seq: 0 }
			);
			await clock.tickAsync(defaultBaseClientOptions.keepalive!);
			connection.expectAndReply(
				{ type: "ping", seq: 1 },
				{ type: "pingack", seq: 1 }
			);
		});

		it("should stop polls when disconnected", async () => {
			await client.close();
			await clock.tickAsync(2 * defaultBaseClientOptions.keepalive!);
			expect(connection.popRequest()).to.be.undefined;
		});

		it("should close connection after ping timeout", async () => {
			const onClose = sinon.spy();
			client.on("close", onClose);
			const onError = sinon.spy();
			client.on("error", onError);

			const login = client.login("user", "pass"); // to check that transactions are aborted
			login.catch(swallowError); // prevent unhandled rejection error, will check later
			connection.popRequest(); // ignore the login
			// Wait for idle ping to be sent
			await clock.tickAsync(defaultBaseClientOptions.keepalive!);
			connection.popRequest(); // remove the ping request
			// Wait for idle ping to be timed out
			await clock.tickAsync(defaultBaseClientOptions.keepalive!);

			expect(onError).to.be.calledOnce;
			expect(onError.firstCall.args[0])
				.to.be.instanceOf(Error)
				.and.property("message")
				.to.contain("timeout");
			expect(onClose).to.be.calledOnceWithExactly();
			await expect(login).to.be.rejectedWith(Error, "timeout");
		});

		it("should not cause double error when ping failed due to disconnect", async () => {
			const onClose = sinon.spy();
			client.on("close", onClose);
			const onError = sinon.spy();
			client.on("error", onError);

			// Wait for idle ping to be sent
			await clock.tickAsync(defaultBaseClientOptions.keepalive!);
			connection.popRequest(); // remove the ping request

			connection.emitError(new Error("boom"));
			await clock.tickAsync(0);

			expect(onError).to.be.calledOnce;
			expect(onError.firstCall.args[0])
				.to.be.instanceOf(Error)
				.and.property("message")
				.to.contain("boom");
			expect(onClose).to.be.calledOnceWithExactly();
		});
	});

	describe("usecases", () => {
		it("simple publisher", async () => {
			const runClient = (async () => {
				await client.connect();
				await client.publish(
					"command",
					"/dev/something",
					"doSomething"
				);
				await client.close();
			})();

			connection.expectAndReply(
				{
					type: "publish",
					node: "command",
					topic: "/dev/something",
					data: "doSomething",
					headers: {},
					seq: 0,
				},
				{ type: "suback", seq: 0 }
			);

			await runClient;
		});

		it("simple subscriber", async () => {
			const messages: Message[] = [];
			const startClient = (async () => {
				client.on("message", (message) => messages.push(message));
				await client.connect();
				await client.subscribe("command", "/dev/something");
			})();

			connection.expectAndReply(
				{
					type: "subscribe",
					node: "command",
					pattern: "/dev/something",
					id: undefined,
					seq: 0,
				},
				{ type: "suback", seq: 0 }
			);
			await startClient;

			connection.emitMessage(
				"default",
				new Message("/dev/something", "doSomething")
			);
			await Promise.resolve();

			const stopClient = (async () => {
				expect(messages).to.deep.equal([
					new Message("/dev/something", "doSomething"),
				]);
				await client.close();
			})();
			await stopClient;
		});
	});
});
