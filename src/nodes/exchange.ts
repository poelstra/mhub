import log from "../log";
import Message from "../message";
import * as pubsub from "../pubsub";

export class Exchange extends pubsub.BaseSource implements pubsub.Destination {
	constructor(name: string) {
		super(name);
	}

	public send(message: Message): void {
		log.push("-> %s", this.name, message.topic);
		this._broadcast(message);
		log.pop();
	}
}

export default Exchange;
