import { describe, expect, test } from "bun:test";

import { cap } from "./panel.ts";

describe("the panel that holds a question", () => {
	test("a shorter question does not move what is under the panel", () => {
		expect(cap(240, 120)).toBe(240);
	});

	test("a taller question is shown whole, so the panel grows to it", () => {
		expect(cap(120, 240)).toBe(240);
	});

	test("the first measurement is the content's own, so nothing is reserved before it", () => {
		expect(cap(0, 180)).toBe(180);
	});
});
