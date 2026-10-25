import { describe, expect, test } from "bun:test";

import type { BoardView } from "@adeildo/pi-kit";

import { Folder } from "../src/folder.ts";

/** A line of the room's log, as the folder reads it. */
function line(session: string, view: BoardView, at = 1) {
	return {
		v: 1,
		id: `e${at}`,
		at,
		session,
		type: "board.changed",
		data: { view },
	} as never;
}

/** A view the writer already cut and ordered: the titles run one way, the `at` the other. */
const view = (...titles: string[]): BoardView => ({
	open: titles.map((title, index) => ({
		id: `c${index + 1}`,
		title,
		column: "doing",
		at: 10 - index,
	})) as never,
	backlog: 0,
	done: [],
});

describe("the board a room carries", () => {
	test("each session's board is kept under its own name, and neither overwrites the other", () => {
		const folder = new Folder();
		folder.apply([line("a", view("from a")), line("b", view("from b"), 2)]);
		expect(folder.boards.get("a")?.open.map((card) => card.title)).toEqual(["from a"]);
		expect(folder.boards.get("b")?.open.map((card) => card.title)).toEqual(["from b"]);
	});

	test("a session that writes again replaces only its own board", () => {
		const folder = new Folder();
		folder.apply([line("a", view("first")), line("b", view("other"))]);
		folder.apply([line("a", view("second", "third"), 2)]);
		// The order the writer gave is the order a reader draws: nothing here sorts or reverses.
		expect(folder.boards.get("a")?.open.map((card) => card.title)).toEqual(["second", "third"]);
		expect(folder.boards.get("b")?.open.map((card) => card.title)).toEqual(["other"]);
	});
});
