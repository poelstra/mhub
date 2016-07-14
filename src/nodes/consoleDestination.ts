import * as pubsub from "../pubsub";
import Message from "../message";

export interface ConsoleDestinationOptions {
}

export class ConsoleDestination implements pubsub.Destination {
	public name: string;

	constructor(name: string, options?: ConsoleDestinationOptions) {
		this.name = name;
	}

	public send(message: Message): void {
		console.log("[" + this.name + "]", message);
	}
}

export default ConsoleDestination;
