// Who a user message is from, decided here and drawn by the document.
import { describe, expect, test } from "bun:test";

import { whoSaid } from "./session-view.ts";

const phone = { kind: "client" as const, name: "phone", machine: "box" };

describe("who a user message is from", () => {
	test("a message the bridge marked is from the client it names", () => {
		expect(whoSaid({ e1: phone }, "e1")).toBe("from phone");
	});

	test("any other message was typed at the terminal, which has always said you", () => {
		expect(whoSaid({ e1: phone }, "e2")).toBe("you");
		expect(whoSaid(undefined, "e1")).toBe("you");
	});

	test("a marked message whose sender has no name says a client, and invents no name", () => {
		expect(whoSaid({ e1: { ...phone, name: "  " } }, "e1")).toBe("from a client");
	});

	test("the client's name is read as text, with no markup carried through", () => {
		const loud = { kind: "client" as const, name: "\u001b[31mred\u001b[0m", machine: "box" };
		expect(whoSaid({ e1: loud }, "e1")).toBe("from red");
	});
});
