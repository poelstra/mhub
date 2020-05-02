// micromatch typings on DT are wrong, quick fix override here
declare module "micromatch" {
	export type MatchFunction<T> = (value: T) => boolean;
	export function matcher(
		pattern: string | string[] | RegExp,
		options?: micromatch.Options
	): MatchFunction<string>;
}
