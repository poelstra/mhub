/**
 * Tests for Session classes.
 */

import { expect } from "chai";
import { getMatcher } from "../src/match";
import Message from "../src/message";
import Exchange from "../src/nodes/exchange";
import { Subscription, Session, SessionType } from "../src/session";
import "./common";

describe("SubscriptionIdNode", (): void => {
	it("buffers messages", () => {
		const sub = new Subscription("sub");
		const received: { topic: string; seq: number }[] = [];
		sub.on("message", (message, seq) =>
			received.push({ topic: message.topic, seq })
		);
		sub.add(new Message("foo1"));
		sub.add(new Message("foo2"));
		sub.add(new Message("foo3"));
		expect(received).to.deep.equal([]);

		sub.ack(0, 2);
		expect(received).to.deep.equal([
			{ topic: "foo1", seq: 1 },
			{ topic: "foo2", seq: 2 },
		]);

		sub.ack(2, 0);
		expect(received).to.deep.equal([
			{ topic: "foo1", seq: 1 },
			{ topic: "foo2", seq: 2 },
		]);

		sub.ack(2, 2);
		expect(received).to.deep.equal([
			{ topic: "foo1", seq: 1 },
			{ topic: "foo2", seq: 2 },
			{ topic: "foo3", seq: 3 },
		]);
	});

	it("supports patterns with auth matching", () => {
		const node = new Exchange("exchange");
		const sub = new Subscription("sub");
		const pattern = "foo/**";
		const patternMatcher = getMatcher(pattern);
		const authMatcher = getMatcher("**/bar");
		const matcher = (topic: string) =>
			patternMatcher(topic) && authMatcher(topic);

		const received: { topic: string; seq: number }[] = [];
		sub.on("message", (message, seq) =>
			received.push({ topic: message.topic, seq })
		);
		sub.ack(0, Infinity);

		sub.subscribe(node, pattern, matcher);
		node.send(new Message("foo/bar"));
		node.send(new Message("foo/baz"));
		node.send(new Message("foz/bar"));

		expect(received).to.deep.equal([{ topic: "foo/bar", seq: 1 }]);
	});

	describe("#ack", () => {
		it("handles acks without any messages", () => {
			const sub = new Subscription("sub");
			expect(() => sub.ack(-1, 1)).to.throw("older than first message");
			expect(() => sub.ack(1, 1)).to.throw("newer than last message");
			sub.ack(0, 1);
		});

		it("handles acks with messages", () => {
			const sub = new Subscription("sub");
			const received: number[] = [];
			sub.on("message", (_msg, seq) => received.push(seq));
			sub.add(new Message("foo1"));
			sub.add(new Message("foo2"));
			sub.add(new Message("foo3"));
			sub.add(new Message("foo4"));

			expect(() => sub.ack(-1, 1)).to.throw("older than first message");
			expect(() => sub.ack(5, 1)).to.throw("newer than last message");

			sub.ack(0, 1); // window = 1 -> release 1
			expect(received).to.deep.equal([1]);
			sub.ack(0, 2); // release another one
			expect(received).to.deep.equal([1, 2]);
			sub.ack(1, 1); // ack the first, but reduce window -> no release
			expect(received).to.deep.equal([1, 2]);
			sub.ack(1, 2); // ack the first (again), increase window -> release 1
			expect(received).to.deep.equal([1, 2, 3]);
			sub.ack(2, 0); // ack second, decrease window even further -> no release
			expect(received).to.deep.equal([1, 2, 3]);
			expect(() => sub.ack(0, 1)).to.throw("older than first message");
			expect(() => sub.ack(5, 1)).to.throw("newer than last message");
		});

		it("allows ack of messages that are not (or no longer) inflight", () => {
			const sub = new Subscription("sub");
			let received: number[] = [];
			sub.on("message", (_msg, seq) => received.push(seq));
			sub.add(new Message("foo1"));
			sub.add(new Message("foo2"));
			sub.add(new Message("foo3"));
			sub.add(new Message("foo4"));
			sub.add(new Message("foo5"));
			sub.ack(0, 3);
			expect(received).to.deep.equal([1, 2, 3]);
			sub.connect(); // force inflight to be reset
			received = [];
			// Suppose that two of the messages were actually received, and the
			// third was lost, then with a new window of 2, we expect foo2 and foo3 to be resent
			sub.ack(2, 2);
			expect(received).to.deep.equal([3, 4]);
			sub.ack(4, 2);
			expect(received).to.deep.equal([3, 4, 5]);
		});
	});
});

describe("Session", () => {
	it("buffers messages for persistent sessions", () => {
		const node = new Exchange("exchange");
		const session = new Session("test", SessionType.Memory);
		const received: { topic: string; id: string; seq: number }[] = [];
		session.attach({
			message: (message, id, seq) =>
				received.push({ topic: message.topic, id, seq }),
			detach: () => {
				/* nop */
			},
		});

		// TODO: Move this test to Subscription
		const sub = session.getOrCreateSubscription("myId");
		sub.subscribe(node, "", () => true);

		node.send(new Message("foo1"));
		node.send(new Message("foo2"));
		node.send(new Message("foo3"));
		expect(received).to.deep.equal([]);

		sub.ack(0, 2);
		expect(received).to.deep.equal([
			{ topic: "foo1", id: "myId", seq: 1 },
			{ topic: "foo2", id: "myId", seq: 2 },
		]);

		sub.ack(2, 2);
		expect(received).to.deep.equal([
			{ topic: "foo1", id: "myId", seq: 1 },
			{ topic: "foo2", id: "myId", seq: 2 },
			{ topic: "foo3", id: "myId", seq: 3 },
		]);
	});

	it("auto-acks messages for volatile sessions by default", () => {
		const node = new Exchange("exchange");
		const session = new Session("test", SessionType.Volatile);
		const received: { topic: string; id: string; seq: number }[] = [];
		session.attach({
			message: (message, id, seq) =>
				received.push({ topic: message.topic, id, seq }),
			detach: () => {
				/* nop */
			},
		});

		// TODO: Move this test to Subscription
		const sub = session.getOrCreateSubscription("myId");
		sub.subscribe(node, "", () => true);

		node.send(new Message("foo1"));
		node.send(new Message("foo2"));
		node.send(new Message("foo3"));
		expect(received).to.deep.equal([
			{ topic: "foo1", id: "myId", seq: 1 },
			{ topic: "foo2", id: "myId", seq: 2 },
			{ topic: "foo3", id: "myId", seq: 3 },
		]);

		// Prevent manual ack on such sessions
		expect(() => sub.ack(3, 10)).to.throw(
			"cannot ack messages on non-session subscriptions"
		);
	});
});
