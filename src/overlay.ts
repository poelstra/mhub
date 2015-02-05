/**
 * Helper classes and functions to communicate with an FLL Overlay Suite Server (a.k.a. the
 * 'old' software).
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import net = require("net");
import util = require("util");
import events = require("events");

/**
 * Encode 'special' characters to %XX, replace newlines by pipe (|), strip \r.
 * @param  s 'Plain text' input string
 * @return Encoded output string
 */
export function messageEncode(s: string): string {
	return s.replace(/[^-.;:!?%&*()_+#\/\[\]a-zA-Z0-9 ]/g, (match: string): string => {
		switch (match) {
			case "\n":
				return "|";
			case "\r":
				return "";
			default:
				return "%" + match.charCodeAt(0).toString(16);
		}
	});
}

/**
 * Decode %-encoded characters to a 'plain text' string, replace | by \r\n
 * @param  s Encoded input string
 * @return Decoded plain text string
 */
export function messageDecode(s: string): string {
	return s.replace("|", "\r\n").replace(/%([0-9a-fA-F]{2})/g, (match: string, p1: string): string => {
		return String.fromCharCode(parseInt(p1, 16));
	});
}

/**
 * Splitter for eventsmode replies
 */
export class Splitter {
	private _data: string;

	/**
	 * Construct new Splitter.
	 *
	 * @param data Comma-separated values to split
	 */
	constructor(data: string) {
		this._data = data;
	}

	getPart(): string {
		var idx = this._data.indexOf(",");
		if (idx < 0) {
			idx = this._data.length + 1;
		}

		var part = this._data.substr(0, idx);
		this._data = this._data.substr(idx + 1);
		return part;
	}


	getRest(): string {
		var rest = this._data;
		this._data = "";
		return rest;
	}
}

export interface ConnectOptions {
	host: string;
	port: number;
	login: string;
}

export interface ProtocolError extends Error {
	code: string;
	errno: number;
	data: string;
}

interface Expected {
	data: string;
	code: number;
	cbOK?: (data: string) => void;
	cbError?: (err: Error) => void;
}

/**
 * OverlayClient connection.
 * Connects to given overlay server and performs login.
 * Emits "ready" event after login succeeded.
 */
export class OverlayClient extends events.EventEmitter {
	private options: ConnectOptions;
	private readbuffer: string = "";
	private expected: Expected[] = [];
	private client: net.Socket;
	private timeout: number = 10000;

	constructor(options: ConnectOptions) {
		super();
		this.options = options;

		this.client = net.connect(options, this._onConnect.bind(this));
		this.client.on("error", this._onError.bind(this));
		this.client.on("data", this._onData.bind(this));
		this.client.on("close", this._onClose.bind(this));
		this.client.on("timeout", this._onTimeout.bind(this));

		this.expect(100, this._onHello.bind(this));
	}

	/**
	 * Switch this connection to EventsMode.
	 * Can be called after "ready" event has been emitted.
	 * The connection can then no longer be used for sending normal commands.
	 * When new events arrive, the "event" event will be emitted.
	 */
	eventsMode(): void {
		this.client.write("eventsmode\n");
		this.expect(200, this._onEventsModeOK.bind(this));
	}

	log(msg: string): void {
		console.log("OverlayClient: " + msg);
	}

	destroy(): void {
		this.client.destroy();
	}

	expect(code: number, cbOK?: (data: string) => void, cbError?: (error: Error) => void): void {
		this.expected.push({
			data: "",
			code: code,
			cbOK: cbOK,
			cbError: cbError
		});
		this.client.setTimeout(this.timeout);
	}

	sendAndExpect(msg: string, code: number, cbOK?: (data: string) => void, cbError?: (error: Error) => void): void {
		this.expect(code, cbOK, cbError);
		this.client.write(msg + "\n");
	}

	private _onConnect(): void {
		this.log("Connected");
	}

	private _onError(e: Error): void {
		this.log("Error: " + util.inspect(e));
		this.emit("error", e);
	}

	private _onTimeout(): void {
		this.log("Timeout");
		this.destroy();
		this.emit("error", new Error("timeout"));
	}

	private _onClose(): void {
		this.log("Closed");
		this.emit("close");
	}

	private _onData(data: string): void {
		if (this.expected.length === 0) {
			this.log("Invalid state, received data, wasn't expecting anything!");
			this.destroy();
			return;
		}

		// Lines are like:
		// 100-Something
		// 100-More
		// 100 Last part
		var lines = (this.readbuffer + data).split("\r\n");
		var line: string;

		// It may be that the last line is not yet 'complete', so don't try to parse it yet.
		// As the last line ends in a newline, the last element of lines will then be an empty
		// string. If it's not an empty string, it must be a partial line.
		line = lines.pop();
		if (line !== "") {
			this.readbuffer = line;
		} else {
			this.readbuffer = "";
		}

		// Parse complete lines
		var expecting = this.expected[0];
		while (line = lines.shift()) {
			// Buffer the data-part of the line(s)
			expecting.data += line.substr(4);

			// Determine whether this is the last line of a code, or a continuation line
			var cont = line.substr(3, 1);
			if (cont === " ") {
				var code = parseInt(line.substr(0, 3), 10); // We only use the code of the last line...

				// Verify code, determine callback to call
				if (expecting.code !== code) {
					var err = <ProtocolError>new Error("protocol error");
					err.code = "EPROTOCOLERROR";
					err.errno = code;
					err.data = expecting.data;
					if (expecting.cbError) {
						expecting.cbError(err);
					} else {
						this.log("Unexpected code " + code + ", expecting " + expecting.code);
						this.client.destroy();
						this._onError(err);
					}
				} else {
					if (expecting.cbOK) {
						expecting.cbOK(expecting.data);
					}
				}

				this.expected.shift();
				expecting = this.expected[0];

				// Note: we don't break out of the loop yet; there may be multiple
				// responses, especially if we wrote multiple commands in one go...

			} else if (cont === "-") {
				expecting.data += "\n";
				continue;
			} else {
				this.log("Invalid line received");
				this.destroy();
				break;
			}
		}

		if (this.expected.length === 0) {
			this.client.setTimeout(0);
		}
	}

	private _onHello(): void {
		this.log("Hello received");
		this.client.write("version 4\n");
		this.expect(200, this._onVersionOK.bind(this));
	}

	private _onVersionOK(data: string): void {
		var version: number;
		try {
			var lines = data.split("\r\n");
			version = parseInt(lines[0].substr(8), 10);
		} catch (e) {
			version = null;
		}
		if (typeof version !== "number" || version < 4) {
			this.log("Invalid protocol version, need at least 4, got " + data);
			this.destroy();
			return;
		}
		this.log("Version OK: " + version);
		this.client.write("login " + this.options.login + "\n");
		this.expect(200, this._onLoginOK.bind(this));
	}

	private _onLoginOK(): void {
		this.log("Login OK");
		this.emit("ready");
	}

	private _onEventsModeOK(): void {
		this.log("Eventsmode OK");
		this.expect(110, this._onEvent.bind(this));
	}

	private _onEvent(data: string): void {
		this.expect(110, this._onEvent.bind(this));
		this.emit("event", data);
	}
}
