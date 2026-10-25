// The scale and the contract a screen relies on: steps that grow, colors that are values, and a type
// scale whose parts are ordered. What a screen picks is a step, never a number.
import { describe, expect, test } from "bun:test";

import { RADIUS, SPACE, theme } from "./theme.ts";

describe("the app's theme", () => {
	test("every step of space and radius grows, so a bigger step is never smaller", () => {
		for (let at = 1; at < SPACE.length; at += 1)
			expect(SPACE[at]).toBeGreaterThan(SPACE[at - 1] as number);
		for (let at = 1; at < RADIUS.length; at += 1)
			expect(RADIUS[at]).toBeGreaterThan(RADIUS[at - 1] as number);
		expect(SPACE[0]).toBe(0);
		expect(RADIUS[0]).toBe(0);
	});

	test("a step reads the table, so a screen never names a number", () => {
		expect(theme.space(3)).toBe(SPACE[3]);
		expect(theme.radius(2)).toBe(RADIUS[2]);
	});

	test("every color a screen may paint is a value, not a name it has to resolve", () => {
		for (const [, value] of Object.entries(theme.color)) {
			expect(value.startsWith("#")).toBe(true);
			expect(value).toHaveLength(7);
		}
	});

	test("a thumb has at least 44 points to press, which no control may undercut", () => {
		expect(theme.hit).toBeGreaterThanOrEqual(44);
	});

	test("the type scale is ordered, so a title is never smaller than the body", () => {
		expect(theme.type.title.fontSize).toBeGreaterThan(theme.type.body.fontSize);
		expect(theme.type.heading.fontSize).toBeGreaterThanOrEqual(theme.type.body.fontSize);
		expect(theme.type.body.fontSize).toBeGreaterThan(theme.type.caption.fontSize);
	});
});
