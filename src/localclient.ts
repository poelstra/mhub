/**
 * MHub client for direct (local) connection to an MHub server instance.
 *
 * A LocalClient has the same interface as e.g. NodeClient, but directly connects
 * to a Hub without using e.g. sockets.
 * This is useful for tests, or when embedding an MHub server and client into a
 * program.
 */

import * as events from "events";

import { BaseClient, Connection } from "./baseclient";
import { Hub } from "./hub";
import { HubClient } from "./hubclient";
import * as protocol from "./protocol";

class LocalConnection extends events.EventEmitter implements Connection {
	private readonly _hub: Hub;
	private readonly _name: string;
	private _hubClient: HubClient | undefined;

	constructor(hub: Hub, name: string) {
		super();
		this._hub = hub;
		this._name = name;
	}

	public async open(): Promise<void> {
		if (this._hubClient) {
			return;
		}
		this._hubClient = new HubClient(this._hub, this._name);
		this._hubClient.on("response", (response: protocol.Response) => {
			this.emit("message", response);
		});
		this._hubClient.on("error", (e: any) => this.emit("error", e));
		this.emit("open");
	}

	/**
	 * Transmit data object.
	 * @return Promise that resolves when transmit is accepted (i.e. not necessarily
	 * arrived at other side, can be e.g. queued).
	 */
	public async send(data: protocol.Command): Promise<void> {
		if (!this._hubClient) {
			throw new Error("not connected");
		}
		await this._hubClient.processCommand(data);
	}

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async close(): Promise<void> {
		this.terminate();
	}

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public async terminate(): Promise<void> {
		if (!this._hubClient) {
			return;
		}
		this._hubClient.close();
		this._hubClient = undefined;
		this.emit("close");
	}
}

/**
 * MHub client using server-side WebSocket.
 *
 * Allows subscribing and publishing to MHub server nodes.
 *
 * @event open() Emitted when connection was established.
 * @event close() Emitted when connection was closed.
 * @event error(e: Error) Emitted when there was a connection, server or protocol error.
 * @event message(m: Message) Emitted when message was received (due to subscription).
 */
export class LocalClient extends BaseClient {
	/**
	 * Create new connection to MServer.
	 * @param url Websocket URL of MServer, e.g. ws://localhost:13900
	 * @param options Optional options, see `MClientOptions`.
	 */
	constructor(hub: Hub, name: string) {
		super(new LocalConnection(hub, name));
	}
}

export default LocalClient;
