import { expect, test } from "bun:test";

import { boardLines } from "../src/board/lines.ts";
import { applyBoard, emptyBoard, type Board, type BoardOp } from "../src/board/model.ts";

const at = 1_700_000_000_000;

function applied(...ops: BoardOp[]): Board {
	let board = emptyBoard();
	for (const op of ops) {
		const result = applyBoard(board, op, "agent");
		if (result.ok) board = result.board;
	}
	return board;
}

test("a card keeps its title column when it changes column", () => {
	const board = applied(
		{ op: "add", title: "Primeira", column: "backlog", at },
		{ op: "add", title: "Segunda", column: "doing", at: at + 1 },
	);
	const [first, second] = boardLines(board);
	expect(first?.indexOf("Primeira")).toBe(second?.indexOf("Segunda"));
});

test("a blocked card names who waits, and a doing card says what happens now", () => {
	const board = applied(
		{ op: "add", title: "Uma", at },
		{ op: "edit", id: "c1", blocked: { on: "operator", why: "o nome" }, at: at + 1 },
		{ op: "add", title: "Duas", column: "doing", at: at + 2 },
		{ op: "edit", id: "c2", now: "medindo", at: at + 3 },
	);
	const lines = boardLines(board);
	expect(lines[0]).toContain("você: o nome");
	expect(lines[1]).toContain("medindo");
});
