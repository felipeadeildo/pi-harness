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

/** A view whose done cards are these titles, in this order. */
const done = (...titles: string[]): BoardView => ({
	open: [],
	backlog: 0,
	done: titles.map((title, index) => ({ id: `d${index + 1}`, title, column: "done", at: 1 })),
});

/** What the room says was finished, oldest first. */
const finished = (folder: Folder) =>
	folder.room.flatMap((item) =>
		item.kind === "happening" && item.happening.kind === "finished" ? [item.happening.title] : [],
	);

describe("the board a room carries", () => {
	test("each session's board is kept under its own name, and neither overwrites the other", () => {
		const folder = new Folder();
		folder.apply([line("a", view("from a")), line("b", view("from b"), 2)]);
		expect(folder.peers.get("a")?.board?.open.map((card) => card.title)).toEqual(["from a"]);
		expect(folder.peers.get("b")?.board?.open.map((card) => card.title)).toEqual(["from b"]);
	});

	test("a session that writes again replaces only its own board", () => {
		const folder = new Folder();
		folder.apply([line("a", view("first")), line("b", view("other"))]);
		folder.apply([line("a", view("second", "third"), 2)]);
		// The order the writer gave is the order a reader draws: nothing here sorts or reverses.
		expect(folder.peers.get("a")?.board?.open.map((card) => card.title)).toEqual([
			"second",
			"third",
		]);
		expect(folder.peers.get("b")?.board?.open.map((card) => card.title)).toEqual(["other"]);
	});

	test("a card that enters the done ones is finished in the room, once, and the first board is not news", () => {
		const folder = new Folder();
		folder.apply([line("a", done("already shipped"))]);
		expect(finished(folder)).toEqual([]);
		folder.apply([line("a", done("already shipped", "the login"), 2)]);
		folder.apply([line("a", done("already shipped", "the login"), 3)]);
		expect(finished(folder)).toEqual(["the login"]);
	});
});
