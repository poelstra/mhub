/**
 * Tests for MHub Client.
 */

import MClient from "../src/client";
import Hub from "../src/hub";
import { PlainAuthenticator } from "../src/authenticator";
import Promise from "ts-promise";
import * as http from "http";
import * as ws from "ws";
import WSConnection from "../src/transports/wsconnection";

import "./common";

class TestServer {
	private _port: number;
	private _hub: Hub;
	private _server: http.Server;
	private _wss: ws.Server;

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

	private _startTransport(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this._server = http.createServer();
			this._wss = new ws.Server({ server: <any>this._server, path: "/" });

			let connectionId = 0;
			this._wss.on("connection", (conn: ws) => {
				new WSConnection(this._hub, conn, "websocket" + connectionId++);
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

	describe("#login", () => {
		it("allows plain login", (): Promise<void> => {
			return client.login("foo", "bar");
		});
	});
});
