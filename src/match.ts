import * as minimatch from "minimatch";

export type Matcher = (value: string) => boolean;

/**
 * Build a function that will return true when its input argument matches the
 * given pattern. If no pattern is given, it will always match.
 *
 * @example
 * ```ts
 * const m = getMatcher("test*");
 * m("foo"); // false
 * m("test"); // true
 * m("tester"); // true
 * ```
 *
 * @param pattern Pattern string or array of pattern strings to match
 * @return Function that returns true when its argument matches the given pattern
 */
export function getMatcher(pattern?: string | string[]): Matcher {
	if (!pattern) {
		return () => true;
	}
	if (Array.isArray(pattern)) {
		const matchers: Matcher[] = pattern.map(getMatcher);
		return (value: string) => matchers.some((m, index) => m(value));
	}
	if (typeof pattern !== "string") {
		throw new TypeError("invalid pattern");
	}
	return <Matcher>minimatch.filter(<string>pattern);
}
