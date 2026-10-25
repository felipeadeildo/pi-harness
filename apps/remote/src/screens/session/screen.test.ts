import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "session.tsx"), "utf8");
/** The code without its comments: the rule is about what renders, and a comment may name what it forbids. */
const screen = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the session screen", () => {
	test("adds no frame of its own: the route owns the space, and the composer keeps its place", () => {
		// A `View` with `flex` here took the composer off the screen and the gate caught it with a click
		// timeout. The screen draws content; the space belongs to the route.
		expect(screen).toContain("<Fragment>");
		expect(screen).not.toMatch(/<View[\s>]/);
		expect(screen).not.toContain("flex");
	});
});
