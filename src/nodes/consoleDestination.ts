import Message from "../message";
import * as pubsub from "../pubsub";

// tslint:disable-next-line:no-empty-interface
export interface ConsoleDestinationOptions {
}

export class ConsoleDestination implements pubsub.Destination {
	public name: string;

	constructor(name: string, options?: ConsoleDestinationOptions) {
		this.name = name;
	}

	public send(message: Message): void {
		// tslint:disable-next-line:no-console
		console.log("[" + this.name + "]", message);
	}
}

export default ConsoleDestination;
