/**
 * Simple username/password authentication.
 */

import Dict from "./dict";

export interface Authenticator {
	/**
	 * Authenticate username/password.
	 * @param username Username.
	 * @param password Password.
	 * @return true if user exists with that password, false otherwise.
	 */
	authenticate(username: string, password: string): boolean;
}

/**
 * Basic username/password-based authentication manager.
 */
export class PlainAuthenticator implements Authenticator {
	private _users: Dict<string> = new Dict<string>(); // Username -> password mapping

	public setUser(username: string, password: string): void {
		this._users.set(username, password);
	}

	public authenticate(username: string, password: string): boolean {
		if (typeof username !== "string" || typeof password !== "string") {
			throw new Error("missing or invalid authentication data provided");
		}
		return this._users.get(username) === password;
	}
}
