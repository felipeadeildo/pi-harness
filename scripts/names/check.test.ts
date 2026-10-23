import { describe, expect, test } from "bun:test";

import { audit, distance, problemWith, sourceOf, wordsIn } from "./check.ts";

describe("a candidate list is held to the word list's rules", () => {
	test("counts the edits between two words", () => {
		expect(distance("otter", "otter")).toBe(0);
		expect(distance("lion", "loin")).toBe(2);
		expect(distance("cat", "dog")).toBe(3);
	});

	test("leaves out what breaks each rule, and says which rule", () => {
		const report = audit(["otter", "otter", "test", "Ab", "gecko", "geckos", "utter", "wombat"]);

		expect(report.words).toEqual(["otter", "gecko", "wombat"]);
		expect(report.left.map((one) => one.why)).toEqual([
			"reads as code or as a command",
			"not one lowercase word of 3 to 8 letters",
			"starts with gec, as gecko does",
			"less than 3 edits from otter",
		]);
		expect(report.removed).toEqual({ shape: 1, denied: 1, letters: 1, close: 1 });
	});

	test("a list that is short of 600 says so before anything else", () => {
		expect(problemWith(["otter", "gecko", "wombat"])).toBe("a list of 3 words, and 600 are needed");
	});

	test("reads back the module it wrote, and a plain candidate file", () => {
		expect(wordsIn(sourceOf(["otter", "gecko"]))).toEqual(["otter", "gecko"]);
		expect(wordsIn("otter\n# a comment in a candidate file\n\ngecko\n")).toEqual([
			"otter",
			"gecko",
		]);
	});
});
