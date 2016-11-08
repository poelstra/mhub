/**
 * Connect WebSocket to an MServer hub.
 */

"use strict";

import * as ws from "ws";

import log from "../log";
import Hub from "../hub";
import HubClient from "../hubclient";
import * as protocol from "../protocol";

export class WSConnection {
	private _hub: Hub;
	private _socket: ws;
	private _name: string;
	private _client: HubClient;

	constructor(hub: Hub, socket: ws, name: string) {
		this._hub = hub;
		this._socket = socket;
		this._name = name;

		this._client = new HubClient(hub, this._name);
		this._client.on("response", this._handleClientResponse.bind(this));

		socket.on("close", this._handleSocketClose.bind(this));
		socket.on("error", this._handleSocketError.bind(this));
		socket.on("message", this._handleSocketMessage.bind(this));

		log.info("[ %s ] connected", this._name);
	}

	private _handleClientResponse(response: protocol.Response): void {
		this._socket.send(JSON.stringify(response));
	}

	private _handleSocketClose(): void {
		this._client.close();
		log.info(`[ ${this._name} ] disconnected`);
	}

	private _handleSocketError(e: Error): void {
		log.error(`[ ${this._name} ] socket error ${e}`);
		this._socket.close(); // will cause close event, which causes client close
	}

	private _handleSocketMessage(data: string): void {
		if (data === "") {
			// Ignore empty lines
			return;
		}
		log.debug(`[ ${this._name} ] command ${data}`);
		try {
			const cmd: protocol.Command = JSON.parse(data);
			this._client.processCommand(cmd);
		} catch (e) {
			log.error(`[ ${this._name} ] protocol error ${e}`);
			this._handleClientResponse({
				type: "error",
				message: `protocol error: ${e}`
			});
		}
	}
}

export default WSConnection;
