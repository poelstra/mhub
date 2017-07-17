import * as pubsub from "../pubsub";
import Message from "../message";
import log from "../log";

export class PingResponder extends pubsub.BaseSource {
	public send(message: Message): void {
		log.push("-> %s", this.name, message.topic);
		this._broadcast(new Message("ping:response", message.data));
		log.pop();
	}
}

export default PingResponder;
