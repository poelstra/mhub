/**
 * Simple dictionary, safe for arbitrary string keys.
 */

export class Dict<T> {
	// tslint:disable-next-line:no-null-keyword
	private _items: { [key: string]: T } = Object.create(null);

	public set(key: string, value: T): void {
		this._items["$" + key] = value;
	}

	public get(key: string): T | undefined {
		return this._items["$" + key];
	}

	public remove(key: string): void {
		delete this._items["$" + key];
	}

	public clear(): void {
		// tslint:disable-next-line:no-null-keyword
		this._items = Object.create(null);
	}

	public keys(): string[] {
		const keys: string[] = [];
		for (const key in this._items) {
			// tslint:disable-line:forin
			keys.push(key.substr(1)); // strip the $
		}
		return keys;
	}

	public forEach(cb: (value: T, key: string, dict: this) => void): void {
		for (const key in this._items) {
			// tslint:disable-line:forin
			cb(this._items[key], key.substr(1), this);
		}
	}
}

export default Dict;
