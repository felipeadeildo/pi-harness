// What the chrome says is decided here and drawn elsewhere: a phone draws with views, and a test cannot.
import { describe, expect, test } from "bun:test";

import { boardCards, terminalWait } from "./panel-data.ts";

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

describe("the board as cards", () => {
	const card = (id: string, title: string, at: number) =>
		({ id, title, column: "doing", at }) as never;

	test("draws the open cards in the order the writer cut them, and sorts nothing", () => {
		// Two cards whose creation order disagrees with the order they arrive in: a comparator on `at`
		// or on the id would reorder them, and this screen must not have an opinion.
		const board = { open: [card("c2", "second", 1), card("c1", "first", 9)], backlog: 0, done: [] };
		expect(boardCards(board as never).map((one) => one.line)).toEqual([
			"doing · second",
			"doing · first",
		]);
	});

	test("a session that has no board says so with nothing, which is not an empty board", () => {
		expect(boardCards(undefined)).toBeUndefined();
		// A board that exists and has no open card is a different thing, and it is a list.
		expect(boardCards({ open: [], backlog: 0, done: [] } as never)).toEqual([]);
	});

	test("a blocker reads in the words of the person holding the phone, whoever it waits on", () => {
		const blocked = {
			open: [
				{ ...card("c1", "waiting on you", 1), blocked: { on: "operator", why: "say go" } },
				{
					...card("c2", "waiting on a colleague", 2),
					blocked: { on: "agent", handle: "otter", why: "review" },
				},
			],
			backlog: 0,
			done: [],
		};
		expect(boardCards(blocked as never)?.[0]?.line).toBe("doing · waiting on you · você: say go");
		expect(boardCards(blocked as never)?.[1]?.line).toBe(
			"doing · waiting on a colleague · @otter: review",
		);
	});

	test("a blocked card says it as the person holding the phone reads it", () => {
		const blocked = {
			open: [{ ...card("c1", "wait", 1), blocked: { on: "operator", why: "the key" } }],
			backlog: 0,
			done: [],
		};
		expect(boardCards(blocked as never)[0]?.line).toBe("doing · wait · você: the key");
	});
});
