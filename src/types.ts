/**
 * Generically useable types.
 */

/**
 * Key-value map using a plain JavaScript object.
 */
export interface KeyValues<T> {
	[key: string]: T;
}
