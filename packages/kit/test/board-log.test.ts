import { expect, test } from "bun:test";

import { BOARD_OP, boardOf, opsOf } from "../src/board/log.ts";

const at = 1_700_000_000_000;
const entry = (op: unknown): unknown => ({
	type: "custom",
	customType: BOARD_OP,
	data: { version: 1, op },
});

test("the board is the fold of the operations the branch wrote, in order", () => {
	const branch = [
		entry({ op: "add", title: "Porta dos clientes", column: "review", at }),
		entry({ op: "move", id: "c1", column: "done", result: "merged", at: at + 1 }),
		entry({ op: "decide", text: "a palavra é board", at: at + 2 }),
	];
	const board = boardOf(branch);
	expect(board.cards[0]?.column).toBe("done");
	expect(board.cards[0]?.result).toBe("merged");
	expect(board.decisions[0]?.text).toBe("a palavra é board");
});

test("an entry that is not a board operation, or a shape this version cannot read, is skipped", () => {
	const branch = [
		{ type: "custom", customType: "pi-tasks:update", data: { state: {} } },
		{ type: "message", data: {} },
		entry({ op: "add", title: "Uma", at }),
		{
			type: "custom",
			customType: BOARD_OP,
			data: { version: 2, op: { op: "add", title: "Duas", at } },
		},
		{ type: "custom", customType: BOARD_OP, data: { version: 1, op: "not an object" } },
		entry({ op: "add", at }),
	];
	expect(opsOf(branch)).toHaveLength(1); // the add without a title is skipped too
	expect(boardOf(branch).cards.map((card) => card.title)).toEqual(["Uma"]);
});
