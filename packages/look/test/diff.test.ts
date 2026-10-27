// An edit's diff in the frame: no box color behind it, the numbers in a gutter, and the tint only on
// the words that changed.
import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { drawDiff, editBody } from "../src/render/diff.ts";

/** Marks colors as tags, so a test reads which text wears which. */
const theme = {
	fg: (color: string, text: string) => (color === "dim" ? text : `<${color}>${text}</>`),
	bg: (color: string, text: string) => `[${color}:${text}]`,
	bold: (text: string) => text,
} as unknown as Theme;

const DIFF = [
	" 367 ",
	"-368 alert (done) | the panel",
	"+368 alert (in production) | the panel",
	"     ...",
	" 409 ## Sources",
].join("\n");

describe("an edit's diff", () => {
	test("puts the numbers in a gutter and tints only the changed words", () => {
		const lines = drawDiff(DIFF, theme, 80);
		expect(lines[0]).toBe("367 <toolDiffContext> </> <toolDiffContext></>");
		expect(lines[1]).toBe(
			"368 <toolDiffRemoved>-</> <toolDiffRemoved>alert ([toolErrorBg:done]) | the panel</>",
		);
		expect(lines[2]).toBe(
			"368 <toolDiffAdded>+</> <toolDiffAdded>alert ([toolSuccessBg:in production]) | the panel</>",
		);
		expect(lines[3]).toBe("      ⋯");
		expect(lines.join("\n")).not.toContain("toolSuccessBg:alert");
	});

	test("a block of lines taken out and put in is not tinted word by word", () => {
		const block = ["-1 a", "-2 b", "+1 c", "+2 d"].join("\n");
		expect(drawDiff(block, theme, 80).join("\n")).not.toContain("Bg:");
	});

	test("a long line wraps under its own text, not under the gutter", () => {
		const lines = drawDiff("+12 one two three four five six", theme, 16);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines[1]).toMatch(/^ {5}\S/);
	});
});

describe("pi's edit body in the frame", () => {
	function own(preview: unknown): Component {
		return Object.assign(
			{ render: () => ["pi's box"], invalidate: () => {} },
			preview === undefined ? {} : { preview },
		);
	}

	test("draws the diff itself once pi holds it, under the path", () => {
		const lines = editBody(own({ diff: "+1 hi" }), "edit a.ts", theme).render(40);
		expect(lines[0]).toBe("edit a.ts");
		expect(lines.join("\n")).not.toContain("pi's box");
		expect(lines.at(-1)).toContain("hi");
	});

	test("leaves pi's drawing while there is no diff yet", () => {
		expect(editBody(own(undefined), "edit a.ts", theme).render(40)).toEqual(["pi's box"]);
	});

	test("says pi's error in the error color", () => {
		const lines = editBody(own({ error: "no match" }), "edit a.ts", theme).render(40);
		expect(lines.at(-1)).toBe("<error>no match</>");
	});
});
