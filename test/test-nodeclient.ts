/**
 * Tests for Node.JS MHub client.
 *
 * These tests mostly cover things like connection logic.
 * Business logic such as authentication, publish/subscribe behaviour
 * etc. are tested elsewhere.
 */

import { expect } from "chai";
import * as http from "http";
import Promise from "ts-promise";
import * as ws from "ws";

import { PlainAuthenticator } from "../src/authenticator";
import Hub from "../src/hub";
import MClient from "../src/nodeclient";
import WSConnection from "../src/transports/wsconnection";

import "./common";

class TestServer {
	public connectionCount: number = 0;

	private _port: number;
	private _hub: Hub;
	private _server: http.Server;
	private _wss: ws.Server;
	private _connectionId: number = 0;
	private _connections: { [id: string]: ws; } = {};

	constructor(port: number) {
		this._port = port;
	}

	public start(): Promise<void> {
		const auth = new PlainAuthenticator();
		auth.setUser("foo", "bar");
		this._hub = new Hub();
		this._hub.setAuthenticator(auth);
		return this._hub.init().then(() => this._startTransport());
	}

	public stop(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this._wss.close((): any => {
				this._server.close(resolve);
			});
		});
	}

	public killConnections(): void {
		Object.keys(this._connections).forEach((id) => {
			this._connections[id].close();
		});
	}

	private _startTransport(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this._server = http.createServer();
			this._wss = new ws.Server({ server: <any>this._server, path: "/" });

			this._wss.on("connection", (conn: ws) => {
				const connId = this._connectionId++;
				// tslint:disable-next-line:no-unused-expression
				new WSConnection(this._hub, conn, "websocket" + connId);
				this._connections[connId] = conn;
				this.connectionCount++;
				conn.once("close", () => {
					this.connectionCount--;
					delete this._connections[connId];
				});
			});

			this._server.listen(this._port, () => resolve(undefined));
			this._server.on("error", (e: Error): void => {
				reject(e);
			});
		});
	}
}

describe("MClient", (): void => {
	let server: TestServer;
	let client: MClient;

	beforeEach(() => {
		const port = 12345;
		server = new TestServer(port);
		return server.start().then(() => {
			client = new MClient(`ws://localhost:${port}`);
			return client.connect();
		});
	});

	afterEach(() => {
		return Promise.all([client.close(), server.stop()]);
	});

	describe("#close", () => {
		it("closes the connection", () => {
			// Note: another close will also be executed in the
			// afterEach() call
			return client.close()
				.delay(10) // FIXME: websocket server calls close event a bit later
				.then(() => {
					expect(server.connectionCount).to.equal(0);
				});
		});

		it("works when server is closed first", () => {
			server.killConnections();
			return Promise.delay(10) // FIXME: websocket server calls close event a bit later
				.then(() => expect(server.connectionCount).to.equal(0))
				.then(() => client.close());
		});
	});

	describe("#connect", () => {
		it("allows connect when already connected", () => {
			return client.connect();
		});

		it("allows to reconnect after closing", () => {
			return client.close()
				.delay(10) // FIXME: websocket server calls close event a bit later
				.then(() => expect(server.connectionCount).to.equal(0))
				.then(() => client.connect())
				.then(() => expect(server.connectionCount).to.equal(1));
		});

		it("allows to reconnect after server closed", () => {
			server.killConnections();
			return Promise.delay(10) // FIXME: websocket server calls close event a bit later
				.then(() => expect(server.connectionCount).to.equal(0))
				.then(() => client.connect())
				.then(() => expect(server.connectionCount).to.equal(1));
		});
	});

	describe("#login", () => {
		it("allows plain login", (): Promise<void> => {
			return client.login("foo", "bar");
		});
	});
});
