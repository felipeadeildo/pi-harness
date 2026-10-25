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

const view = (title: string): BoardView => ({
	open: [{ id: "c1", title, column: "doing", at: 1 } as never],
	backlog: 0,
	done: [],
});

describe("the board a room carries", () => {
	test("each session's board is kept under its own name, and neither overwrites the other", () => {
		const folder = new Folder();
		folder.apply([line("a", view("from a")), line("b", view("from b"), 2)]);
		expect(folder.boards.get("a")?.open[0]?.title).toBe("from a");
		expect(folder.boards.get("b")?.open[0]?.title).toBe("from b");
	});

	test("a session that writes again replaces only its own board", () => {
		const folder = new Folder();
		folder.apply([line("a", view("first")), line("b", view("other"))]);
		folder.apply([line("a", view("second"), 2)]);
		expect(folder.boards.get("a")?.open[0]?.title).toBe("second");
		expect(folder.boards.get("b")?.open[0]?.title).toBe("other");
	});
});
