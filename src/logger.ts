/**
 * Debug helper to print nested messages.
 * See log.ts for a convenient singleton instance of this.
 */

"use strict";

import * as util from "util";

class Logger {
	private indent: string = "";

	/**
	 * Debug function that is called whenever a noteworthy action happens within
	 * the pubsub logic, e.g. when a message is routed from an exchange to a
	 * destination (which could be another Exchange, a Queue, etc.)
	 * Default action is to log the message to the console.
	 */
	public onMessage = (msg: string): void => {
		console.log(msg);
	};

	public write(fmt: string, ...args: any[]): void;
	public write(...args: any[]): void {
		if (this.onMessage) {
			var msg = this.indent + util.format.apply(undefined, args);
			this.onMessage(msg);
		}
	}

	public push(fmt: string, ...args: any[]): void;
	public push(...args: any[]): void {
		this.write.apply(this, args);
		this.indent += "  ";
	}

	public pop(): void {
		this.indent = this.indent.slice(0, -2);
	}
}

export default Logger;
