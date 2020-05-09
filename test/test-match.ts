import { expect } from "chai";

import { getMatcher } from "../src/match";

describe("getMatcher()", () => {
	it("returns pass-all matcher for undefined pattern", () => {
		const matcher = getMatcher();
		expect(matcher("foo")).to.equal(true);
	});

	it("returns pass-all matcher for empty pattern", () => {
		const matcher = getMatcher("");
		expect(matcher("foo")).to.equal(true);
	});

	it("returns string matcher for single string", () => {
		const matcher = getMatcher("foo*");
		expect(matcher("fooz")).to.equal(true);
		expect(matcher("bar")).to.equal(false);
	});

	it("returns string matcher for string array", () => {
		const matcher = getMatcher(["foo*", "bar*"]);
		expect(matcher("fooz")).to.equal(true);
		expect(matcher("barz")).to.equal(true);
		expect(matcher("baz")).to.equal(false);
	});

	it("returns argument if it is already a function", () => {
		const f = () => true;
		const matcher = getMatcher(f);
		expect(matcher).to.equal(f);
	});

	it("rejects invalid patterns", () => {
		expect(() => getMatcher(null as any)).to.throw(TypeError);
		expect(() => getMatcher(1 as any)).to.throw(TypeError);
		expect(() => getMatcher({} as any)).to.throw(TypeError);
		expect(() => getMatcher(true as any)).to.throw(TypeError);
		expect(() => getMatcher(false as any)).to.throw(TypeError);
	});
});
