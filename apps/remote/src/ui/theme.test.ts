// The scale and the contract a screen relies on: steps that grow, colors that are values, and a type
// scale whose parts are ordered. What a screen picks is a step, never a number.
import { describe, expect, test } from "bun:test";

import { HIT, RADIUS, SPACE, type Scheme, themeFor } from "./theme.ts";

const SCHEMES: Scheme[] = ["light", "dark"];
const theme = themeFor("light");

/** The WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
	const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
		const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colors, 1 to 21. */
function contrast(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((light as number) + 0.05) / ((dark as number) + 0.05);
}

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
		for (const scheme of SCHEMES)
			for (const [, value] of Object.entries(themeFor(scheme).color)) {
				expect(value.startsWith("#")).toBe(true);
				expect(value).toHaveLength(7);
			}
	});

	test("both schemes name the same colors, so a screen asks for a name and never for a scheme", () => {
		expect(Object.keys(themeFor("dark").color)).toEqual(Object.keys(themeFor("light").color));
	});

	test("the dark scheme is dark: its background is darker than its text, and the light one the reverse", () => {
		const light = themeFor("light").color;
		const dark = themeFor("dark").color;
		expect(luminance(light.background)).toBeGreaterThan(luminance(light.text));
		expect(luminance(dark.background)).toBeLessThan(luminance(dark.text));
	});

	test("what a screen reads, text and the quiet text, stays legible on the surfaces in both schemes", () => {
		// 4.5:1 is the WCAG floor for body text. The faint color is for placeholders and is not held to it.
		for (const scheme of SCHEMES) {
			const { color } = themeFor(scheme);
			for (const surface of [color.background, color.surface, color.elevated]) {
				expect(contrast(color.text, surface)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(color.muted, surface)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	test("the document has a face of its own, so a web view does not draw it in a serif", () => {
		expect(theme.font).toContain("system-ui");
	});

	test("a thumb has at least 44 points to press, which no control may undercut", () => {
		for (const scheme of SCHEMES) expect(themeFor(scheme).hit).toBeGreaterThanOrEqual(44);
		expect(HIT).toBe(themeFor("light").hit);
	});

	test("the type scale is ordered, so a title is never smaller than the body", () => {
		expect(theme.type.title.fontSize).toBeGreaterThan(theme.type.body.fontSize);
		expect(theme.type.heading.fontSize).toBeGreaterThanOrEqual(theme.type.body.fontSize);
		expect(theme.type.body.fontSize).toBeGreaterThan(theme.type.caption.fontSize);
	});
});
