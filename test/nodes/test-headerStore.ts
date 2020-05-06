/**
 * Tests for HeaderStore node.
 */

import { expect } from "chai";

import { PlainAuthenticator } from "../../src/authenticator";
import { Dict } from "../../src/dict";
import Hub from "../../src/hub";
import { LocalClient } from "../../src/localclient";
import Message from "../../src/message";
import HeaderStore from "../../src/nodes/headerStore";
import { Storage } from "../../src/storage";

import "../common";

// TODO move to be reusable
export class MemStorage<T> implements Storage<T> {
	private _store: Dict<string> = new Dict();

	public save(key: string, value: T): Promise<void> {
		return new Promise((resolve) => {
			this._store.set(key, JSON.stringify(value));
			resolve(undefined);
		});
	}

	public load(key: string): Promise<T | undefined> {
		return new Promise<T | undefined>((resolve, reject) => {
			const data = this._store.get(key);
			if (data === undefined) {
				return resolve(undefined);
			}
			resolve(JSON.parse(data));
		});
	}
}

function createHub(storage: Storage<any>): Hub {
	const auth = new PlainAuthenticator();
	const hub = new Hub(auth);
	hub.add(new HeaderStore("default"));
	hub.setRights({ "": true });
	hub.setStorage(storage);
	return hub;
}

describe("nodes/HeaderStore", (): void => {
	let hub: Hub;
	let client: LocalClient;
	let msgs: { [id: string]: Message[] };

	beforeEach(() => {
		hub = createHub(new MemStorage());

		client = new LocalClient(hub, "test");
		client.on("message", (msg: Message, id: string) => {
			if (!msgs[id]) {
				msgs[id] = [];
			}
			msgs[id].push(msg);
		});
		msgs = {};

		return hub.init().then(() => client.connect());
	});

	afterEach(() => client.close());

	it("keeps message when header is set", () => {
		return Promise.resolve()
			.then(() => client.publish("default", "a"))
			.then(() =>
				client.publish("default", "b", undefined, { keep: true })
			)
			.then(() => client.close())
			.then(() => client.connect())
			.then(() => client.subscribe("default"))
			.then(() => client.publish("default", "c"))
			.then(() => {
				expect(msgs).to.deep.equal({
					default: [
						new Message("b", undefined, { keep: true }),
						new Message("c", undefined, {}),
					],
				});
			});
	});

	it("maintains topic order", () => {
		// Note the order: ABC DEF CBA DEF
		return Promise.resolve()
			.then(() =>
				client.publish("default", "a", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "b", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "c", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "d", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "e", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "f", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "c", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "b", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "a", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "d", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "e", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "f", undefined, { keep: true })
			)
			.then(() => client.close())
			.then(() => client.connect())
			.then(() => client.subscribe("default"))
			.then(() => client.publish("default", "x"))
			.then(() => {
				expect(msgs).to.deep.equal({
					default: [
						new Message("c", undefined, { keep: true }),
						new Message("b", undefined, { keep: true }),
						new Message("a", undefined, { keep: true }),
						new Message("d", undefined, { keep: true }),
						new Message("e", undefined, { keep: true }),
						new Message("f", undefined, { keep: true }),
						new Message("x", undefined, {}),
					],
				});
			});
	});

	it("only returns subscribed messages", () => {
		return Promise.resolve()
			.then(() =>
				client.publish("default", "a", undefined, { keep: true })
			)
			.then(() =>
				client.publish("default", "b", undefined, { keep: true })
			)
			.then(() => client.close())
			.then(() => client.connect())
			.then(() => client.subscribe("default", "a", "id1"))
			.then(() => client.subscribe("default", "b", "id2"))
			.then(() => client.publish("default", "x"))
			.then(() => {
				expect(msgs).to.deep.equal({
					id1: [new Message("a", undefined, { keep: true })],
					id2: [new Message("b", undefined, { keep: true })],
				});
			});
	});
});
