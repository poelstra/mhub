import log from "../log";
import Message from "../message";
import * as pubsub from "../pubsub";

// tslint:disable-next-line:no-empty-interface
export interface ExchangeOptions extends pubsub.BaseSourceOptions {
}

export class Exchange extends pubsub.BaseSource implements pubsub.Destination {
	constructor(name: string, options?: ExchangeOptions) {
		super(name, options);
	}

	public send(message: Message): void {
		log.push("-> %s", this.name, message.topic);
		this._broadcast(message);
		log.pop();
	}
}

export default Exchange;
