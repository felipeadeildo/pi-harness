import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
	join(import.meta.dir, "..", "..", "app", "session", "[machine]", "[id].tsx"),
	"utf8",
);

describe("the session route", () => {
	test("hands the composer everything in one spread, and names no field from the snapshot", () => {
		// The route can only be rendered with an expo-router context and a live client, so what is
		// checked here is the shape that made the bug possible: a route that names `mode` by hand is a
		// route that can name `session.snapshot?.mode` again, and every screen still draws.
		expect(route).toContain("{...composer}");
		expect(route).not.toMatch(/snapshot\?\.(mode|model|thinkingLevel)/);
		expect(route).not.toMatch(/mode=\{|model=\{|thinking=\{/);
	});
});
