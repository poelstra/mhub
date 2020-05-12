/**
 * Central container of Nodes, with possibility to have clients connect to it.
 * One Hub can be re-used by many different endpoint protocols (such as
 * WebSocket servers, raw TCP ports, etc.)
 *
 * A HubClient can be used to (internally) connect to a Hub, and is in
 * turn used by e.g. TcpConnection, WSConnection, and LocalClient.
 */

import { Authenticator } from "./authenticator";
import Dict from "./dict";
import { getMatcher, Matcher, allowAll } from "./match";
import * as pubsub from "./pubsub";
import { Session } from "./session";
import { Storage } from "./storage";
import { assertOrDie } from "./util";

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
export type Permission =
	| boolean
	| {
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

type PermissionMatcher = false | Matcher;

interface PermissionMatchers {
	publish: boolean | Map<string, PermissionMatcher>;
	subscribe: boolean | Map<string, PermissionMatcher>;
}

function permissionToMatchers(
	permission: Permission
): boolean | Map<string, PermissionMatcher> {
	if (typeof permission === "boolean") {
		return permission;
	}
	const result = new Map<string, PermissionMatcher>();
	for (const node of Object.keys(permission)) {
		const nodePermission = permission[node];
		if (nodePermission === false) {
			result.set(node, false);
		} else if (nodePermission === true) {
			result.set(node, allowAll);
		} else {
			result.set(node, getMatcher(nodePermission));
		}
	}
	return result;
}

export class Authorizer {
	private _permissions: PermissionMatchers;

	constructor(partialPermissions: PartialPermissions | undefined) {
		if (typeof partialPermissions === "boolean") {
			partialPermissions = partialPermissions
				? defaultAllowPermissions
				: defaultDenyPermissions;
		}
		const permissions: Permissions = {
			...defaultPermissions,
			...partialPermissions,
		};
		this._permissions = {
			publish: permissionToMatchers(permissions.publish),
			subscribe: permissionToMatchers(permissions.subscribe),
		};
	}

	public canPublish(node: string, topic: string): boolean {
		const matcher = this._getMatcher(this._permissions.publish, node);
		if (!matcher) {
			return false;
		}
		return matcher(topic);
	}

	public getSubscribeMatcher(node: string): false | Matcher {
		return this._getMatcher(this._permissions.subscribe, node);
	}

	private _getMatcher(
		permission: boolean | Map<string, PermissionMatcher>,
		node: string
	): false | Matcher {
		if (!permission) {
			return false;
		}
		if (permission === true) {
			return allowAll;
		}
		const nodePermission = permission.get(node);
		if (!nodePermission) {
			return false;
		}
		return getMatcher(nodePermission);
	}
}

export class Hub {
	private _nodes: Dict<pubsub.BaseNode> = new Dict<pubsub.BaseNode>();
	private _authenticator: Authenticator;
	private _rights: Dict<PartialPermissions> = new Dict<PartialPermissions>();
	private _storage: Storage<any> | undefined;
	private _sessions: Map<string, Map<string, Session>> = new Map();

	constructor(authenticator: Authenticator) {
		this._authenticator = authenticator;
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
		const initPromises: Promise<void>[] = [];
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

	public async authenticate(
		username: string,
		password: string
	): Promise<boolean> {
		return this._authenticator.authenticate(username, password);
	}

	public findSession(
		username: string,
		sessionId: string
	): Session | undefined {
		const userSessions = this._sessions.get(username);
		if (!userSessions) {
			return undefined;
		}
		const session = userSessions.get(sessionId);
		if (!session) {
			return undefined;
		}
		return session;
	}

	public registerSession(
		username: string,
		sessionId: string,
		session: Session
	): void {
		let userSessions = this._sessions.get(username);
		if (!userSessions) {
			userSessions = new Map();
			this._sessions.set(username, userSessions);
		}
		const existingSession = userSessions.get(sessionId);
		if (existingSession) {
			existingSession.destroy();
		}

		session.on("destroy", () => {
			assertOrDie(
				userSessions?.get(sessionId) === session,
				"destroyed session does not match registered session"
			);
			userSessions?.delete(sessionId);
		});
		userSessions.set(sessionId, session);
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
			throw new TypeError(
				`invalid UserRights: object or boolean expected for user "${user}"`
			);
		}
		// Check each Permission
		for (const action in perms) {
			// publish/subscribe
			if (!perms.hasOwnProperty(action)) {
				continue;
			}
			const perm = perms[action as keyof Permissions];
			if (typeof perm === "boolean") {
				continue;
			}
			if (typeof perm !== "object") {
				throw new TypeError(
					`invalid UserRights: object or boolean expected for user "${user}", action "${action}"`
				);
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
					throw new TypeError(
						`invalid UserRights: boolean, string or array of strings expected for user ` +
							`"${user}", action "${action}", node "${node}"`
					);
				}
				const allStrings = nodePerm.every((x) => typeof x === "string");
				if (!allStrings) {
					throw new TypeError(
						`invalid UserRights: boolean, string or array of strings expected for user ` +
							`"${user}", action "${action}", node "${node}"`
					);
				}
			}
		}
	}
}

export default Hub;
