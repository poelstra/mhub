import log from "./log";
import { fail } from "assert";

export function isStringArray(value: unknown): value is string | string[] {
	if (!Array.isArray(value)) {
		return false;
	}
	if (value.every((element) => typeof element === "string")) {
		return true;
	}
	return false;
}

export function isStringOrStringArray(
	value: unknown
): value is string | string[] {
	if (typeof value === "string" || isStringArray(value)) {
		return true;
	}
	return false;
}

export function die(fmt: string, ...args: any[]): never {
	log.fatal(fmt, ...args);
	process.exit(1);
}

export function assertOrDie(
	expression: boolean,
	message?: string,
	...args: any[]
): asserts expression {
	if (!expression) {
		message = message ?? "assertion failed";
		die(message, ...args);
	}
}

export function assertNever(value: never, message?: string): never {
	message =
		message ?? `assertion failed, expected value to be never, got ${value}`;
	fail(message);
}

export function assertNeverOrDie(value: never, message?: string): never {
	message =
		message ?? `assertion failed, expected value to be never, got ${value}`;
	die(message);
}

export function swallowError(_error: any): void {
	/* no op */
}

export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (error: Error) => void;
}

export function deferred<T>(): Deferred<T> {
	let resolve: Deferred<T>["resolve"];
	let reject: Deferred<T>["reject"];
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {
		promise,
		resolve: resolve!,
		reject: reject!,
	};
}
