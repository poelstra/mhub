/**
 * Central container of Nodes, with possibility to have clients connect to it.
 * One Hub can be re-used by many different endpoint protocols (such as
 * WebSocket servers, raw TCP ports, etc.)
 *
 * Use e.g. a HubClient to actually connect something to a Hub.
 */

"use strict";

import Promise from "ts-promise";

import Dict from "./dict";
import * as pubsub from "./pubsub";

class Hub {
	private _nodes: Dict<pubsub.BaseNode> = new Dict<pubsub.BaseNode>();

	public init(): Promise<void> {
		const initPromises: Promise<void>[] = [];
		this._nodes.forEach(node => {
			if (node.init) {
				initPromises.push(node.init());
			}
		});
		return Promise.all(initPromises).then(() => { /* nop */ });
	}

	public add(node: pubsub.BaseNode): void {
		if (this.find(node.name)) {
			throw new Error("duplicate node: " + node.name);
		}
		this._nodes.set(node.name, node);
	}

	public find(nodeName: string): pubsub.BaseNode | undefined {
		return this._nodes.get(nodeName);
	}

	public findSource(nodeName: string): pubsub.Source | undefined {
		const n = this.find(nodeName);
		return pubsub.isSource(n) ? n : undefined;
	}

	public findDestination(nodeName: string): pubsub.Destination | undefined {
		const n = this.find(nodeName);
		return pubsub.isDestination(n) ? n : undefined;
	}
}

export default Hub;
