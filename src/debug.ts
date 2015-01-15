/// <reference path="../typings/tsd.d.ts" />

"use strict";

import util = require("util");

export class Debug {
	/**
	 * Debug function that is called whenever a noteworthy action happens within the pubsub logic, e.g.
	 * when a message is routed from an exchange to a destination (which could be another Exchange,
	 * a Queue, etc.)
	 * Default action is to log the message to the console.
	 */
	public onDebug = (msg: string): void => {
		console.log(msg);
	};

	private indent: string = "";

	write(fmt: string, ...args: any[]): void;
	write(...args: any[]): void {
		if (this.onDebug) {
			var msg = this.indent + util.format.apply(null, args);
			this.onDebug(msg);
		}
	}

	push(fmt: string, ...args: any[]): void;
	push(...args: any[]): void {
		this.write.apply(this, args);
		this.indent += "  ";
	}

	pop(): void {
		this.indent = this.indent.slice(0, -2);
	}
}

export var debug = new Debug();
