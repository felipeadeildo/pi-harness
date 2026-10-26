import { expect, test } from "bun:test";

import { applyBoard, emptyBoard, type Board, type BoardOp } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { BoardPanel } from "../src/board/board-panel.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function applied(...ops: BoardOp[]): Board {
	let board = emptyBoard();
	for (const op of ops) {
		const result = applyBoard(board, op, "agent");
		if (result.ok) board = result.board;
	}
	return board;
}

test("a card that changes column does not move the other lines", () => {
	let board = applied(
		{ op: "add", title: "Primeira", at: 1 },
		{ op: "add", title: "Segunda", at: 2 },
	);
	const panel = new BoardPanel({
		theme: plain,
		close: () => {},
		requestRender: () => {},
		read: () => board,
	});
	const before = panel.render(80);
	const moved = applyBoard(board, { op: "move", id: "c2", column: "doing", at: 3 }, "agent");
	expect(moved.ok).toBe(true);
	if (moved.ok) board = moved.board;
	const after = panel.render(80);
	expect(after[1]).toBe(before[1]);
	expect(after[2]).not.toBe(before[2]);
});

test("an empty board says so, and escape closes it", () => {
	let closed = false;
	const panel = new BoardPanel({
		theme: plain,
		close: () => {
			closed = true;
		},
		requestRender: () => {},
	});
	expect(panel.render(80)[0]).toContain("0 open");
	panel.handleInput("\u001b");
	expect(closed).toBe(true);
});
