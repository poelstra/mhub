import log from "../log";
import Message from "../message";
import * as pubsub from "../pubsub";

export class PingResponder extends pubsub.BaseSource {
	public send(message: Message): void {
		log.push("-> %s", this.name, message.topic);
		this._broadcast(new Message("ping:response", message.data));
		log.pop();
	}
}

export default PingResponder;
