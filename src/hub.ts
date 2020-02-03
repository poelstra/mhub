/**
 * Central container of Nodes, with possibility to have clients connect to it.
 * One Hub can be re-used by many different endpoint protocols (such as
 * WebSocket servers, raw TCP ports, etc.)
 *
 * A HubClient can be used to (internally) connect to a Hub, and is in
 * turn used by e.g. TcpConnection, WSConnection, and LocalClient.
 */

import { Authenticator, PlainAuthenticator } from "./authenticator";
import Dict from "./dict";
import { getMatcher, Matcher } from "./match";
import * as pubsub from "./pubsub";
import { Storage } from "./storage";

/**
 * Specify what permission a user has to e.g. publish or subscribe.
 * If specified as a boolean, the permission is granted/denied for
 * all nodes (and access denied will be returned regardless of whether
 * the specified node exists or not).
 * If specified as an object, rights can be set per node.
 * Again, the right per node can be set as a boolean to allow/deny
 * everything on that node, or only allow specific topic pattern or
 * patterns.
 * Note that when using a pattern, a subscribe call may succeed,
 * even though the rights would not allow any message to be received
 * by that user using the given subscription pattern. This is because
 * the server currently doesn't perform an intersection on the patterns
 * to see if they are disjoint.
 */
export type Permission = boolean | {
	[nodeName: string]: boolean | string | string[];
};

/**
 * Permissions specify whether a user can e.g. publish or subscribe
 * to certain nodes and/or topics.
 */
export interface Permissions {
	publish: Permission;
	subscribe: Permission;
}

/**
 * Partial permissions allow quick setting of only the items
 * that differ from the default permissions (which typically
 * deny everything).
 * It can also be set to a boolean, in which case the
 * defaultAllowPermissions or defaultDenyPermissions will be
 * used (for true and false, respectively).
 */
export type PartialPermissions = boolean | Partial<Permissions>;

export interface UserRights {
	[username: string]: PartialPermissions;
}

export const defaultDenyPermissions: Permissions = {
	publish: false,
	subscribe: false,
};

export const defaultAllowPermissions: Permissions = {
	publish: true,
	subscribe: true,
};

export const defaultPermissions = defaultDenyPermissions;

export class Authorizer {
	private _permissions: Permissions;
	// tslint:disable-next-line:no-null-keyword
	private _publishMatchers: { [nodeName: string]: Matcher; } = Object.create(null);

	constructor(partialPermissions: PartialPermissions | undefined) {
		if (typeof partialPermissions === "boolean") {
			partialPermissions = partialPermissions ? defaultAllowPermissions : defaultDenyPermissions;
		}
		this._permissions = { ...defaultPermissions, ...partialPermissions };
	}

	public canPublish(node: string, topic: string): boolean {
		// Note: Matcher doesn't occur for publish, because the topic is never considered pattern
		return this._hasPermission(this._permissions.publish, node, topic, false) === true;
	}

	public canSubscribe(node: string, pattern?: string): boolean | Matcher {
		return this._hasPermission(this._permissions.subscribe, node, pattern, true);
	}

	private _hasPermission(
		permission: Permission,
		node: string,
		topicOrPattern: string | undefined,
		isPattern: boolean
	): boolean | Matcher {
		if (typeof permission === "boolean") {
			return permission;
		}
		// Otherwise, must be a node->(boolean | string | string[]) map
		const nodePermission = permission[node];
		if (nodePermission === undefined) {
			return false;
		}
		if (typeof nodePermission === "boolean") {
			return nodePermission;
		}
		if (isPattern) {
			// If pattern is specified as-is, we grant access completely, no further
			// filtering necessary. If pattern isn't found, we assume the two patterns
			// (subscription and permissions) may intersect, but further checking will
			// be necessary.
			if (typeof nodePermission === "string") {
				if (nodePermission === topicOrPattern) {
					return true;
				}
				return getMatcher(nodePermission);
			}
			const patternFoundInPermissions = nodePermission.some((pattern) => pattern === topicOrPattern);
			if (patternFoundInPermissions) {
				return true;
			} else {
				return getMatcher(nodePermission);
			}
		} else { // topicOrPattern is a topic
			let matcher = this._publishMatchers[node];
			if (!matcher) {
				this._publishMatchers[node] = getMatcher(nodePermission);
				matcher = this._publishMatchers[node];
			}
			return (topicOrPattern !== undefined) && matcher(topicOrPattern);
		}
	}
}

export class Hub {
	private _nodes: Dict<pubsub.BaseNode> = new Dict<pubsub.BaseNode>();
	private _authenticator: Authenticator;
	private _rights: Dict<PartialPermissions> = new Dict<PartialPermissions>();
	private _storage: Storage<any> | undefined;

	constructor(authenticator?: Authenticator) {
		this._authenticator = authenticator || new PlainAuthenticator();
	}

	public getAuthenticator(): Authenticator {
		return this._authenticator;
	}

	public setRights(rights: UserRights): void {
		validateUserRights(rights);
		this._rights.clear();
		Object.keys(rights).forEach((user) => {
			this._rights.set(user, rights[user]);
		});
	}

	public getAuthorizer(username: string): Authorizer {
		const partialPermissions = this._rights.get(username);
		return new Authorizer(partialPermissions);
	}

	public init(): Promise<void> {
		const initPromises: Array<Promise<void>> = [];
		this._nodes.forEach((node) => {
			if (node.init) {
				initPromises.push(node.init(this));
			}
		});
		return Promise.all(initPromises).then(() => undefined);
	}

	public setStorage(storage: Storage<any>): void {
		this._storage = storage;
	}

	public getStorage<T>(): Storage<T> | undefined {
		// TODO: allowing caller to pass in storage sub-type is unsafe, but don't
		// now of a generic but better way to fix that right now. Note that the
		// storage users currently do check for the validity of the actual stored
		// data, so it's fine in practice.
		return this._storage;
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

	public async authenticate(username: string, password: string): Promise<boolean> {
		if (!this._authenticator) {
			throw new Error("missing authenticator");
		}
		return await this._authenticator.authenticate(username, password);
	}
}

/**
 * Test validity of structure of UserRights.
 * Throws an error if it's incorrect.
 */
export function validateUserRights(rights: UserRights): void {
	if (typeof rights !== "object") {
		throw new TypeError("invalid UserRights: object expected");
	}
	const users = Object.keys(rights);
	for (const user of users) {
		// Obtain Permissions object per user
		const perms = rights[user];
		if (typeof perms === "boolean") {
			continue;
		}
		if (typeof perms !== "object") {
			throw new TypeError(`invalid UserRights: object or boolean expected for user "${user}"`);
		}
		// Check each Permission
		for (const action in perms) { // publish/subscribe
			if (!perms.hasOwnProperty(action)) {
				continue;
			}
			const perm = perms[action as keyof Permissions];
			if (typeof perm === "boolean") {
				continue;
			}
			if (typeof perm !== "object") {
				throw new TypeError(`invalid UserRights: object or boolean expected for user "${user}", action "${action}"`);
			}

			// It's a node->bool|string|string[] map
			for (const node in perm) {
				if (!perm.hasOwnProperty(node)) {
					continue;
				}
				const nodePerm = perm[node];
				if (typeof nodePerm === "boolean") {
					continue;
				}
				if (typeof nodePerm === "string") {
					continue;
				}
				if (!Array.isArray(nodePerm)) {
					throw new TypeError(`invalid UserRights: boolean, string or array of strings expected for user ` +
						`"${user}", action "${action}", node "${node}"`);
				}
				const allStrings = nodePerm.every((x) => typeof x === "string");
				if (!allStrings) {
					throw new TypeError(`invalid UserRights: boolean, string or array of strings expected for user ` +
							`"${user}", action "${action}", node "${node}"`);
				}
			}
		}
	}
}

export default Hub;
