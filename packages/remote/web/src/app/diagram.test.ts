import { describe, expect, test } from "bun:test";

import { drawable } from "./diagram.ts";

const FLOW = "flowchart LR\n  A[Mermaid text] --> B[SVG]";

describe("a mermaid block", () => {
	test("once written, is drawn whole", () => {
		expect(drawable(FLOW, false)).toEqual({ text: FLOW });
	});

	test("while it streams, draws the lines written so far, never the one being written", () => {
		expect(drawable(`${FLOW}\n  B --> C`, true)).toEqual({ text: FLOW });
	});

	test("while it streams, draws nothing until a line of it parses", () => {
		expect(drawable("flowchart LR\n  A[Merm", true)).toBeUndefined();
	});

	test("that does not parse says on which line and what it expected", () => {
		const shown = drawable("flowchart LR\n  A[open --> B", false);
		expect(shown).toEqual({
			error: expect.stringMatching(/^Parse error on line 2: Expecting .+ got '\$end'$/),
		});
	});

	test("that is no diagram says so", () => {
		expect(drawable("hello", false)).toEqual({
			error: "No diagram type detected for the given text.",
		});
	});
});
