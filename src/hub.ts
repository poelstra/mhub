/**
 * Central container of Nodes, with possibility to have clients connect to it.
 * One Hub can be re-used by many different endpoint protocols (such as
 * WebSocket servers, raw TCP ports, etc.)
 *
 * Use e.g. a HubClient to actually connect something to a Hub.
 */

"use strict";

import Promise from "ts-promise";

import { Authenticator } from "./authenticator";
import Dict from "./dict";
import * as pubsub from "./pubsub";

export interface Permissions {
	publish: boolean;
	subscribe: boolean;
}

export type PartialPermissions = Partial<Permissions>;

export interface UserRights {
	[username: string]: PartialPermissions;
}

export const defaultPermissions: Permissions = {
	publish: false,
	subscribe: false,
};

export class Hub {
	private _nodes: Dict<pubsub.BaseNode> = new Dict<pubsub.BaseNode>();
	private _authenticator: Authenticator;
	private _rights: Dict<PartialPermissions> = new Dict<PartialPermissions>();

	public setAuthenticator(authenticator: Authenticator): void {
		this._authenticator = authenticator;
	}

	public setRights(rights: UserRights): void {
		this._rights.clear();
		Object.keys(rights).forEach((user) => {
			this._rights.set(user, rights[user]);
		});
	}

	public getUserPermissions(username: string): Permissions {
		const partialPermissions = this._rights.get(username);
		return {...defaultPermissions, ...partialPermissions};
	}

	public init(): Promise<void> {
		const initPromises: Promise<void>[] = [];
		this._nodes.forEach(node => {
			if (node.init) {
				initPromises.push(node.init());
			}
		});
		return Promise.all(initPromises).return();
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

	public authenticate(username: string, password: string): boolean {
		if (!this._authenticator) {
			throw new Error("missing authenticator");
		}
		return this._authenticator.authenticate(username, password);
	}
}

export default Hub;
