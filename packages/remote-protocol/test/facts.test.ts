// The two shapes the daemon and the bridge disagreed on, pinned where the reducers read them: a
// stream is the number pi gives it, and a leaf may be null when a `/tree` move goes back to the root.
import { describe, expect, test } from "bun:test";

import { isFact } from "../src/facts.ts";

describe("a fact the daemon has to carry", () => {
	test("a bound stream is the number pi numbered it with", () => {
		expect(isFact("stream.bound", { messages: [{ stream: 3, entry: "e1" }] })).toBe(true);
	});

	test("a leaf back at the root is a leaf change, not a broken fact", () => {
		expect(isFact("leaf.changed", { leaf: null })).toBe(true);
		expect(isFact("leaf.changed", { leaf: "e1" })).toBe(true);
	});

	test("a leaf of the wrong shape is still refused", () => {
		expect(isFact("leaf.changed", { leaf: 4 })).toBe(false);
		expect(isFact("leaf.changed", {})).toBe(false);
	});
});
