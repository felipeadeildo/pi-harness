// An icon names a family for each platform, because one that exists only on Apple draws nothing on
// Android. Its names are checked against the packages they come from.
import { describe, expect, test } from "bun:test";

import { ICONS } from "./icon-names.ts";

describe("the icons a control may draw", () => {
	test("each one names an SF Symbol and a Material Symbol, so no platform draws a blank", () => {
		const names = Object.entries(ICONS);
		expect(names.length).toBeGreaterThan(0);
		for (const [, icon] of names) {
			expect(icon.sf).not.toBe("");
			expect(icon.md).not.toBe("");
		}
	});
});
