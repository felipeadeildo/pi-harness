// What the chrome says is decided here and drawn elsewhere: a phone draws with views, and a test cannot.
import { describe, expect, test } from "bun:test";

import { terminalWait } from "./panel-data.ts";

describe("the line for a dialog only the terminal can answer", () => {
	test("nothing is said while the terminal waits on nothing", () => {
		expect(terminalWait(undefined)).toBeUndefined();
	});

	test("the dialog's own title says what it is", () => {
		expect(terminalWait({ kind: "custom", title: "Pick a theme" })).toBe(
			"Waiting in the terminal: Pick a theme",
		);
	});

	test("a dialog with no title is named by its kind, and a blank title counts as none", () => {
		expect(terminalWait({ kind: "editor" })).toBe("Waiting in the terminal: an editor");
		expect(terminalWait({ kind: "custom", title: "  " })).toBe("Waiting in the terminal: a dialog");
	});

	test("a title is read as text, with no markup carried through", () => {
		expect(terminalWait({ kind: "custom", title: "\u001b[31mred\u001b[0m" })).toBe(
			"Waiting in the terminal: red",
		);
	});
});
