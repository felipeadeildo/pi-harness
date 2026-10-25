// Where a user message was typed, decided here and drawn by the document.
import { describe, expect, test } from "bun:test";

import { originOf } from "./session-view.ts";

const phone = { kind: "client" as const, name: "phone", machine: "box" };

describe("where a user message was typed", () => {
	test("a message the bridge marked says the client it names", () => {
		expect(originOf({ e1: phone }, "e1")).toBe("from phone");
	});

	test("a message with no mark says nothing, which is not the same as saying the terminal", () => {
		expect(originOf({ e1: phone }, "e2")).toBeUndefined();
		expect(originOf(undefined, "e1")).toBeUndefined();
	});

	test("a marked message whose sender has no name says a client, and invents no name", () => {
		expect(originOf({ e1: { ...phone, name: "  " } }, "e1")).toBe("from a client");
	});

	test("the client's name is read as text, with no markup carried through", () => {
		const loud = { kind: "client" as const, name: "\u001b[31mred\u001b[0m", machine: "box" };
		expect(originOf({ e1: loud }, "e1")).toBe("from red");
	});
});
