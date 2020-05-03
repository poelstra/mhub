import log from "./log";

export function die(fmt: string, ...args: any[]): void {
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
