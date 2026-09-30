import { describe, expect, test } from "bun:test";

import { nextMode, parseMode } from "#core/mode.ts";
import { toggleOutside } from "#core/workspace.ts";

describe("nextMode", () => {
	test("cycles manual, edits, judge, full, and back", () => {
		expect(nextMode("manual")).toBe("edits");
		expect(nextMode("edits")).toBe("judge");
		expect(nextMode("judge")).toBe("full");
		expect(nextMode("full")).toBe("manual");
	});
});

describe("parseMode", () => {
	test("takes every mode by name", () => {
		expect(parseMode("manual")).toBe("manual");
		expect(parseMode(" Judge ")).toBe("judge");
		expect(parseMode("full")).toBe("full");
	});

	test("takes the 4.x names still in settings files and saved sessions", () => {
		expect(parseMode("accept-edits")).toBe("edits");
		expect(parseMode("accept edits")).toBe("edits");
		expect(parseMode("auto")).toBe("full");
		expect(parseMode("yolo")).toBe("full");
	});

	test("rejects anything else", () => {
		expect(parseMode("nope")).toBeUndefined();
		expect(parseMode("")).toBeUndefined();
	});
});

describe("toggleOutside", () => {
	test("Alt+W moves between asking and no boundary, and out of deny", () => {
		expect(toggleOutside("ask")).toBe("allow");
		expect(toggleOutside("allow")).toBe("ask");
		expect(toggleOutside("deny")).toBe("allow");
	});
});
