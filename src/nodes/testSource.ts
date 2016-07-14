"use strict";

import * as pubsub from "../pubsub";
import Message from "../message";
import log from "../log";

export interface TestSourceOptions extends pubsub.BaseSource {
	topic?: string; // Topic to use for test messages (default "blib")
	interval?: number; // Interval for sending test messages (in ms, default 5000ms)
}

export class TestSource extends pubsub.BaseSource {
	constructor(name: string, options?: TestSourceOptions) {
		super(name, options);

		const topic: string = options && options.topic || "blib";
		const interval: number = options && options.interval || 5000;
		let blibCount = 0;
		const sender = () => { this._broadcast(new Message(topic, blibCount++)); };
		setTimeout(sender, 0); // Send one right away
		setInterval(sender,	interval);
	}
}

export default TestSource;
