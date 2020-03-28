/**
 * Debug helper to print nested messages.
 * See log.ts for a convenient singleton instance of this.
 */

import * as util from "util";

export enum LogLevel {
	None,
	Fatal,
	Error,
	Warning,
	Info,
	Debug,
}

export class Logger {
	/**
	 * Which level of messages to log.
	 */
	public logLevel: LogLevel = LogLevel.Info;

	/**
	 * Indentation for certain debug messages (message tracing).
	 */
	private indent: string = "";

	/**
	 * Debug function that is called whenever a noteworthy action happens within
	 * the pubsub logic, e.g. when a message is routed from an exchange to a
	 * destination (which could be another Exchange, a Queue, etc.)
	 * Default action is to log the message to the console.
	 */
	public onMessage = (msg: string): void => {
		// tslint:disable-next-line:no-console
		console.log(msg);
	};

	public fatal(fmt: string, ...args: any[]): void {
		this.write(LogLevel.Fatal, fmt, ...args);
	}

	public error(fmt: string, ...args: any[]): void {
		this.write(LogLevel.Error, fmt, ...args);
	}

	public warning(fmt: string, ...args: any[]): void {
		this.write(LogLevel.Warning, fmt, ...args);
	}

	public info(fmt: string, ...args: any[]): void {
		this.write(LogLevel.Info, fmt, ...args);
	}

	public debug(fmt: string, ...args: any[]): void {
		this.write(LogLevel.Debug, this.indent + fmt, ...args);
	}

	public write(level: LogLevel, fmt: string, ...args: any[]): void {
		if (!this.onMessage || level > this.logLevel) {
			return;
		}
		// Prefix log level character (e.g. [E])
		fmt = `[${LogLevel[level][0]}] ${fmt}`;
		// In debug mode, prefix timestamp before that
		if (this.logLevel === LogLevel.Debug) {
			fmt = `${new Date().toISOString()} ${fmt}`;
		}
		const msg = util.format(fmt, ...args);
		this.onMessage(msg);
	}

	public push(fmt: string, ...args: any[]): void {
		this.debug(fmt, ...args);
		this.indent += "  ";
	}

	public pop(): void {
		this.indent = this.indent.slice(0, -2);
	}
}

export default Logger;
