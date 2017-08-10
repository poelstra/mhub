/**
 * Connect TCP socket to an MServer hub.
 */

import * as net from "net";

import Hub from "../hub";
import HubClient from "../hubclient";
import log from "../log";
import * as protocol from "../protocol";

export class TcpConnection {
	private _hub: Hub;
	private _socket: net.Socket;
	private _name: string;
	private _client: HubClient;
	private _buffer: string = "";

	constructor(hub: Hub, socket: net.Socket, name: string) {
		this._hub = hub;
		this._socket = socket;
		this._name = name;

		this._client = new HubClient(hub, this._name);
		this._client.on("response", this._handleClientResponse.bind(this));

		socket.setEncoding("utf8");
		socket.on("close", this._handleSocketClose.bind(this));
		socket.on("error", this._handleSocketError.bind(this));
		socket.on("data", this._handleSocketData.bind(this));

		log.info("[ %s ] connected", this._name);
	}

	private _handleClientResponse(response: protocol.Response): void {
		this._socket.write(JSON.stringify(response) + "\n");
	}

	private _handleSocketClose(): void {
		this._client.close();
		log.info(`[ ${this._name} ] disconnected`);
	}

	private _handleSocketError(e: Error): void {
		log.error(`[ ${this._name} ] socket error ${e}`);
		this._socket.destroy(); // will cause close event, which causes client close
	}

	private _handleSocketData(chunk: string): void {
		// Add new chunk to buffer, start looking for lines
		// in buffer
		this._buffer += chunk;
		while (this._buffer.length > 0) {
			const p = this._buffer.indexOf("\n");
			if (p < 0) {
				// Incomplete line, keep it in buffer for now
				break;
			}
			// Strip first line from buffer
			const line = this._buffer.substr(0, p).trim();
			this._buffer = this._buffer.substr(p + 1);
			if (!line) {
				// Ignore empty lines
				continue;
			}
			// Process line
			log.debug(`[ ${this._name} ] command ${line}`);
			try {
				const cmd: protocol.Command = JSON.parse(line);
				this._client.processCommand(cmd);
			} catch (e) {
				log.error(`[ ${this._name} ] protocol error ${e}`);
				this._handleClientResponse({
					type: "error",
					message: `protocol error: ${e}`,
				});
				this._socket.destroy();
				break;
			}
		}
	}
}

export default TcpConnection;
