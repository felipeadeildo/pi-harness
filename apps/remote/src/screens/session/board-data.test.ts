import { describe, expect, test } from "bun:test";

import type { BoardView } from "@adeildo/pi-remote-protocol";

import { boardLinesOf } from "./board-data.ts";

const card = (id: string, title: string, column: string, blocked?: unknown): never =>
	({ id, title, column, at: 0, ...(blocked === undefined ? {} : { blocked }) }) as never;

const view = (over: Partial<BoardView> = {}): BoardView =>
	({
		open: [card("c1", "ship the parser", "doing"), card("c2", "review the docs", "review")],
		backlog: 2,
		done: [card("c0", "written", "done")],
		...over,
	}) as BoardView;

describe("the board a session keeps", () => {
	test("the cards keep the writer's order, with the column each one is in", () => {
		// The order is the writer's: reversing it here would be the screen deciding what to show first.
		expect(boardLinesOf(view())?.open.map((one) => one.title)).toEqual([
			"ship the parser",
			"review the docs",
		]);
		expect(boardLinesOf(view())?.open.map((one) => one.column)).toEqual(["doing", "review"]);
	});

	test("a blocker reads in the words of the person holding this phone", () => {
		const blocked = view({
			open: [
				card("c1", "waiting on you", "doing", { on: "operator", why: "say go" }),
				card("c2", "waiting on a colleague", "doing", {
					on: "agent",
					handle: "otter",
					why: "review",
				}),
			],
		});
		expect(boardLinesOf(blocked)?.open[0]?.blocked).toBe("você: say go");
		expect(boardLinesOf(blocked)?.open[1]?.blocked).toBe("@otter: review");
	});

	test("a card without a blocker carries no text, and a session without a board carries no lines", () => {
		expect(boardLinesOf(view())?.open[0]?.blocked).toBeUndefined();
		// Absent is not empty: nothing drawn, not an empty board claiming there is nothing to do.
		expect(boardLinesOf(undefined)).toBeUndefined();
	});
});
