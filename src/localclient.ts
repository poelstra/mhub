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
	private _hubClient: HubClient;

	constructor(hub: Hub, name: string) {
		super();

		this._hubClient = new HubClient(hub, name);
		this._hubClient.on("response", (response: protocol.Response) => {
			this.emit("message", response);
		});
		this._hubClient.on("error", (e: any) => this.emit("error", e));
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
		await this._hubClient.processCommand(data);
	}

	/**
	 * Gracefully close connection, i.e. allow pending transmissions
	 * to be completed.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public close(): Promise<void> {
		this._hubClient.close();
		this.emit("close");
		return Promise.resolve();
	}

	/**
	 * Forcefully close connection.
	 * @return Promise that resolves when connection is succesfully closed.
	 */
	public terminate(): Promise<void> {
		this._hubClient.close();
		return Promise.resolve();
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
		super(
			() => new LocalConnection(hub, name)
		);
	}
}

export default LocalClient;
