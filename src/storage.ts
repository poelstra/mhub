/**
 * Simple file storage.
 */

import * as fs from "fs";
import * as path from "path";
import Promise from "ts-promise";
import { sync as mkdirpSync } from "mkdirp";

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
	load(key: string): Promise<T|void>;
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
			let data = JSON.stringify(value);
			fs.writeFile(
				tmpFile,
				data + (data ? "\n" : ""),
				"utf8",
				(err: Error) => {
					if (err) {
						reject(err);
					} else {
						resolve(undefined);
					}
				}
			);
		}).then(() => {
			return new Promise<void>((resolve, reject) => {
				fs.rename(tmpFile, realFile, (err: Error) => {
					if (err) {
						reject(err);
					} else {
						resolve(undefined);
					}
				});
			});
		});
	}

	public load(key: string): Promise<T|void> {
		return new Promise<T|void>((resolve, reject) => {
			fs.readFile(
				this._getFilename(key),
				"utf8",
				(err: Error, data: string) => {
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
	lastValue: T;
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
		const item = this._saveQueue[key];
		if (item) {
			item.lastValue = value;
			return item.promise;
		}
		const promise = new Promise<void>((resolve) => {
			setTimeout(
				() => {
					const latestItem = this._saveQueue[key];
					delete this._saveQueue[key];
					if (latestItem) {
						resolve(this._slave.save(key, latestItem.lastValue));
					} else {
						resolve(undefined); // already saved...
					}
				},
				this._delay
			);
		});
		this._saveQueue[key] = {
			lastValue: value,
			promise: promise,
		};
		return promise;
	}

	public load(key: string): Promise<T|void> {
		return this._slave.load(key);
	}
}

// TODO This global storage is basically a kludge, and needs to be moved
// to e.g. a Hub class, which can then be passed to all created nodes.

let defaultStorage: Storage<any>;

export function getDefaultStorage(): Storage<any> {
	return defaultStorage;
}

export function setDefaultStorage(storage: Storage<any>): void {
	defaultStorage = storage;
}
