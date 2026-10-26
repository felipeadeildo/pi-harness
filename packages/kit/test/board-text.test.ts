import { describe, expect, test } from "bun:test";

import { type BoardOp, emptyBoard, foldBoard } from "../src/board/model.ts";
import { describeBoard } from "../src/board/text.ts";

const at = 1;

// Created in an order the sections do not follow: backlog and to-do cards come before the card
// being done, so a description that kept the board's order without grouping reads differently.
// All but the last card share one `at`.
const OPS: BoardOp[] = [
	{ op: "add", title: "Ship the login", column: "todo", at },
	{ op: "add", title: "Write the notes", column: "backlog", at },
	{ op: "add", title: "Answer the operator", at, blocked: { on: "operator", why: "which name?" } },
	{ op: "add", title: "Fix the gate", column: "doing", pr: 12, at },
	{ op: "edit", id: "c4", now: "running the gate", at },
	{ op: "add", title: "Review the theme", at },
	{ op: "move", id: "c5", column: "review", reviewer: "badger", at },
	{ op: "add", title: "Old cleanup", at },
	{ op: "move", id: "c6", column: "done", at },
	{ op: "add", title: "Bump the lock", at },
	{ op: "move", id: "c7", column: "done", result: "bun.lock", at },
	{ op: "move", id: "c1", column: "done", result: "merged", at },
	{ op: "add", title: "Port the parser", at },
	{ op: "drop", id: "c8", why: "the board replaced it", at },
	{ op: "decide", text: "One secret", at },
	{ op: "decide", text: "The port is a setting", at },
	{ op: "decide", text: "Icons are native", at },
	// Last in the board, first by title, by `at` and by id read as text: any sort moves it up.
	{ op: "add", title: "Add the icons", at: 0 },
];
const board = foldBoard(OPS, "operator");

describe("where the session stands, from its board", () => {
	test("the open cards go under their column, doing first, and keep the board's order inside it", () => {
		const open = describeBoard(board).split("\nDone:")[0];
		expect(open).toBe(
			[
				"Doing:",
				"- c4 Fix the gate (#12) (now: running the gate)",
				"In review:",
				"- c5 Review the theme (reviewer: badger)",
				"To do:",
				"- c3 Answer the operator (blocked on o operador: which name?)",
				"- c12 Add the icons",
				"Backlog:",
				"- c2 Write the notes",
			].join("\n"),
		);
	});

	// The board keeps a card where it was created, so "Ship the login", done last, is still the first
	// done card: the cut follows the board's order and does not sort by when a card closed.
	test("done cards and decisions are cut to the last ones in the board's order", () => {
		const closed = describeBoard(board, { done: 2, decisions: 2 }).split(
			"Backlog:\n- c2 Write the notes\n",
		)[1];
		expect(closed).toBe(
			[
				"Done:",
				"- c6 Old cleanup",
				"- c7 Bump the lock → bun.lock",
				"Decided:",
				"- d10 The port is a setting",
				"- d11 Icons are native",
			].join("\n"),
		);
	});

	test("a dropped card is not where the session stands", () => {
		expect(board.cards.find((card) => card.id === "c8")?.column).toBe("dropped");
		expect(describeBoard(board)).not.toContain("Port the parser");
	});

	test("an empty board says nothing, so a reader can leave its section out", () => {
		expect(describeBoard(emptyBoard())).toBe("");
		const dropped = foldBoard([
			{ op: "add", title: "Port the parser", at },
			{ op: "drop", id: "c1", why: "the board replaced it", at },
		]);
		expect(dropped.cards).toHaveLength(1);
		expect(describeBoard(dropped)).toBe("");
	});
});
