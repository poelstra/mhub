/**
 * Simple file storage.
 */

import * as fs from "fs";
import { sync as mkdirpSync } from "mkdirp";
import * as path from "path";

import { delay } from "./promise";
import { KeyValues } from "./types";

export interface Storage<T> {
	/**
	 * Save `value` to storage under given `key` as identifier.
	 * Note: `value` needs to be JSON serializable.
	 * Previous contents (if any) will be overwritten.
	 *
	 * @param  {string}        key   Identifier to use for later retrieval
	 * @param  {T}             value Data to persist
	 * @return {Promise<void>}       Promise that resolves when data is persisted
	 */
	save(key: string, value: T): Promise<void>;

	/**
	 * Load data for given `key` from storage.
	 * Returns a JSON deserialized representation of the data, or `undefined` if
	 * the key could not be found.
	 *
	 * @param  {string}     key Identifier of the data as used by `save()`
	 * @return {Promise<T>}     Promise that resolves with the data, or `undefined` if not found
	 */
	load(key: string): Promise<T | undefined>;
}

export class SimpleFileStorage<T> implements Storage<T> {
	private _rootDir: string;

	constructor(rootDir: string) {
		this._rootDir = rootDir;
		mkdirpSync(this._rootDir);
	}

	public save(key: string, value: T): Promise<void> {
		// First save it to a temp file, then move that over the original
		// to make it an atomic replace
		const realFile = this._getFilename(key);
		const tmpFile = realFile + ".tmp";
		return new Promise<void>((resolve, reject) => {
			const data = JSON.stringify(value);
			fs.writeFile(
				tmpFile,
				data + (data ? "\n" : ""),
				"utf8",
				(err: Error | null) => {
					if (err) {
						reject(err);
					} else {
						resolve(undefined);
					}
				}
			);
		}).then(() => {
			return new Promise<void>((resolve, reject) => {
				fs.rename(tmpFile, realFile, (err: Error | null) => {
					if (err) {
						reject(err);
					} else {
						resolve(undefined);
					}
				});
			});
		});
	}

	public load(key: string): Promise<T | undefined> {
		return new Promise<T | undefined>((resolve, reject) => {
			fs.readFile(
				this._getFilename(key),
				"utf8",
				(err: Error | null, data: string) => {
					if (err) {
						if ((<any>err).code === "ENOENT") {
							// Return `undefined` when key does not exist (yet)
							resolve(undefined);
						}
						reject(err);
					} else {
						try {
							resolve(JSON.parse(data));
						} catch (e) {
							reject(e);
						}
					}
				}
			);
		});
	}

	private _getFilename(key: string): string {
		return path.resolve(this._rootDir, key + ".json");
	}
}

interface ThrottleItem<T> {
	lastValue: T | undefined;
	promise: Promise<void>;
}

export class ThrottledStorage<T> implements Storage<T> {
	private _slave: Storage<T>;
	private _saveQueue: KeyValues<ThrottleItem<T>> = Object.create(null); // tslint:disable-line:no-null-keyword
	private _delay: number;

	constructor(storage: Storage<T>, throttleDelay: number = 100) {
		this._slave = storage;
		this._delay = throttleDelay;
	}

	public save(key: string, value: T): Promise<void> {
		// TODO make sure to flush on exit!

		const doSave = () => {
			const latestItem = this._saveQueue[key];
			const lastValue = latestItem.lastValue;
			// Mark existing record as 'in-progress' by unsetting
			// the value. If another save is requested, it will still
			// be chained after the current write.
			latestItem.lastValue = undefined;
			if (lastValue !== undefined) {
				return this._slave.save(key, lastValue);
			}
		};

		// Get or create pending action record for this key
		let item = this._saveQueue[key];
		if (!item) {
			item = {
				lastValue: undefined,
				promise: Promise.resolve(),
			};
			this._saveQueue[key] = item;
		}

		// If no save action is currently scheduled (either because there
		// was none, or because an existing save is currently underway)
		// schedule a new one
		if (item.lastValue === undefined) {
			item.lastValue = value;
			item.promise = item.promise
				.then(() => delay(this._delay))
				.then(doSave)
				.finally(() => {
					// If there are no pending saves anymore, we can safely remove
					// the record for this key, otherwise keep it until the scheduled
					// save is done with it
					if (item.lastValue === undefined) {
						delete this._saveQueue[key];
					}
				});
		}

		return item.promise;
	}

	public load(key: string): Promise<T | undefined> {
		return this._slave.load(key);
	}
}
