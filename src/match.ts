import * as micromatch from "micromatch";

export type Matcher = (value: string) => boolean;

export type MatchSpec = string | string[] | Matcher;

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
export function getMatcher(pattern?: MatchSpec): Matcher {
	if (!pattern) {
		return () => true;
	}
	if (typeof pattern === "function") {
		return pattern;
	}
	return micromatch.matcher(pattern, {
		strictSlashes: true,
	});
}
