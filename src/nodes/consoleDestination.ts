import Message from "../message";
import * as pubsub from "../pubsub";

export class ConsoleDestination implements pubsub.Destination {
	public name: string;

	constructor(name: string) {
		this.name = name;
	}

	public send(message: Message): void {
		// tslint:disable-next-line:no-console
		console.log("[" + this.name + "]", message);
	}
}

export default ConsoleDestination;
