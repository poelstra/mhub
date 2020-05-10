import { expect } from "chai";

import { Destination, BaseSource } from "../src/pubsub";
import Message from "../src/message";
import { getMatcher } from "../src/match";

class TestDestination implements Destination {
	public name: string;
	public messages: Message[] = [];

	constructor(name: string) {
		this.name = name;
	}

	public send(message: Message): void {
		this.messages.push(message);
	}
}

class TestSource extends BaseSource {
	public send(message: Message): void {
		this._broadcast(message);
	}
}

describe("pubsub", () => {
	it("binds source to destination for all topics", () => {
		const source = new TestSource("source");
		const dest = new TestDestination("dest");
		source.bind(dest);
		const m1 = new Message("foo");
		source.send(m1);
		expect(dest.messages).to.deep.equal([m1]);
	});

	it("binds source to destination for specific topics", () => {
		const source = new TestSource("source");
		const dest = new TestDestination("dest");
		source.bind(dest, "foo*");
		const m1 = new Message("bar");
		const m2 = new Message("foo");
		const m3 = new Message("fooz");
		source.send(m1);
		source.send(m2);
		source.send(m3);
		expect(dest.messages).to.deep.equal([m2, m3]);
	});

	it("unbinds source from destination for specific topics", () => {
		const source = new TestSource("source");
		const dest = new TestDestination("dest");
		source.bind(dest, "foo*");
		source.bind(dest, "bar*");
		source.unbind(dest, "foo*");
		const m1 = new Message("foo");
		const m2 = new Message("bar");
		source.send(m1);
		source.send(m2);
		expect(dest.messages).to.deep.equal([m2]);
	});

	it("unbinds everything for a node", () => {
		const source = new TestSource("source");
		const dest = new TestDestination("dest");
		source.bind(dest, "foo*");
		source.bind(dest, "bar*");
		source.unbind(dest);
		const m1 = new Message("foo");
		const m2 = new Message("bar");
		source.send(m1);
		source.send(m2);
		expect(dest.messages).to.deep.equal([]);
	});

	it("supports a function for binding", () => {
		const source = new TestSource("source");
		const dest = new TestDestination("dest");
		source.bind(dest, getMatcher("foo*"));
		const m1 = new Message("foo");
		const m2 = new Message("bar");
		source.send(m1);
		source.send(m2);
		expect(dest.messages).to.deep.equal([m1]);
	});

	it("supports binding multiple destinations", () => {
		const source = new TestSource("source");
		const dest1 = new TestDestination("dest1");
		const dest2 = new TestDestination("dest2");
		source.bind(dest1, "foo*");
		source.bind(dest2, "foo*");
		source.bind(dest2, "bar*");
		const m1 = new Message("foo");
		const m2 = new Message("bar");
		source.send(m1);
		source.send(m2);
		expect(dest1.messages).to.deep.equal([m1]);
		expect(dest2.messages).to.deep.equal([m1, m2]);
	});

	it("supports unbinding multiple destinations", () => {
		const source = new TestSource("source");
		const dest1 = new TestDestination("dest1");
		const dest2 = new TestDestination("dest2");
		source.bind(dest1, "foo*");
		source.bind(dest2, "foo*");
		source.bind(dest2, "bar*");
		source.unbind(dest2, "foo*");
		const m1 = new Message("foo");
		const m2 = new Message("bar");
		source.send(m1);
		source.send(m2);
		expect(dest1.messages).to.deep.equal([m1]);
		expect(dest2.messages).to.deep.equal([m2]);
	});
});
