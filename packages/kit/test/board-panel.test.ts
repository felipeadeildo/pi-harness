// The Alt+T panel: the board in the kit's frame, the open cards under their column, the wait in its
// own color, and a long board that scrolls inside the terminal.
import { describe, expect, test } from "bun:test";

import { applyBoard, boardText, emptyBoard, type Board, type BoardOp } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { BoardPanel } from "../src/board/board-panel.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

/** Marks the warning color, so a test can see which words wear it. */
const marked = {
	fg: (color: string, text: string) => (color === "warning" ? `<w>${text}</w>` : text),
	bold: (text: string) => text,
} as unknown as Theme;

function applied(...ops: BoardOp[]): Board {
	let board = emptyBoard();
	for (const op of ops) {
		const result = applyBoard(board, op, "operator");
		if (result.ok) board = result.board;
	}
	return board;
}

function panel(board: Board, options: { theme?: Theme; rows?: number } = {}) {
	let closed = false;
	let renders = 0;
	const drawn = new BoardPanel({
		theme: options.theme ?? plain,
		close: () => {
			closed = true;
		},
		requestRender: () => {
			renders++;
		},
		read: () => board,
		...(options.rows === undefined ? {} : { rows: () => options.rows ?? 0 }),
	});
	return { drawn, closed: () => closed, renders: () => renders };
}

const SESSION = applied(
	{ op: "add", title: "Expose OAuth instead of an API key", at: 1 },
	{ op: "move", id: "c1", column: "done", result: "the Workers OAuth provider", at: 2 },
	{ op: "add", title: "One secret with an auth mode", column: "doing", pr: 41, at: 3 },
	{ op: "edit", id: "c2", now: "53 tests pass, writing the README", at: 4 },
	{ op: "add", title: "Show loading while history arrives", at: 5 },
	{ op: "move", id: "c3", column: "review", reviewer: "badger", at: 6 },
	{
		op: "add",
		title: "Push the fix to main",
		at: 7,
		blocked: { on: "operator", why: "production has no SECRET yet" },
	},
	{ op: "add", title: "Write the release notes", column: "backlog", at: 8 },
	{ op: "decide", text: "One SECRET with a mode", at: 9 },
);

describe("the board panel", () => {
	test("wears the frame, with the counts on its top edge and the way out on the bottom", () => {
		const lines = panel(SESSION).drawn.render(80);
		expect(lines[0]).toMatch(/^╭─ Board ─+ 3 open {3}1 in the backlog {3}1 done ─╮$/);
		expect(lines.at(-1)).toMatch(/^╰─ esc close ─+╯$/);
		expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true);
	});

	test("puts each open card under its column, in the column order, then what was delivered and decided", () => {
		const text = panel(SESSION).drawn.render(80).join("\n");
		const order = [
			"Doing 1",
			"One secret with an auth mode  #41",
			"53 tests pass, writing the README",
			"In review 1",
			"Show loading while history arrives",
			"@badger reviews",
			"To do 1",
			"Push the fix to main",
			"Done lately 1",
			"the Workers OAuth provider",
			"Decisions 1",
			"One SECRET with a mode",
		].map((words) => text.indexOf(words));
		expect(order.every((at) => at >= 0)).toBe(true);
		expect(order).toEqual(order.toSorted((left, right) => left - right));
		expect(text).not.toContain("Write the release notes");
	});

	test("a card that waits names what it waits on in the warning color", () => {
		const text = panel(SESSION, { theme: marked }).drawn.render(80).join("\n");
		expect(text).toContain("<w>⚑</w> Push the fix to main");
		expect(text).toContain("<w>você: production has no SECRET yet</w>");
	});

	test("a long title wraps under its own words instead of being cut", () => {
		const long = applied({
			op: "add",
			title: "Make the remote page reopen where phones left",
			column: "doing",
			at: 1,
		});
		const lines = panel(long).drawn.render(40);
		const at = lines.findIndex((line) => line.includes("◆ Make"));
		expect(lines[at + 1]).toMatch(/^│ {4}\S/);
		expect(lines.join(" ")).toContain("left");
	});

	test("the decisions keep the last three, and the heading says of how many", () => {
		const many = applied(
			...["one", "two", "three", "four", "five"].map((text, index): BoardOp => ({
				op: "decide",
				text: `Decision ${text}`,
				at: index + 1,
			})),
		);
		const text = panel(many).drawn.render(80).join("\n");
		expect(text).toContain("Decisions last 3 of 5");
		expect(text).not.toContain("Decision two");
		expect(text).toContain("Decision five");
	});

	test("an empty board says what fills it", () => {
		expect(panel(emptyBoard()).drawn.render(80).join("\n")).toContain("Nothing on the board yet");
	});

	test("a board taller than the terminal scrolls, and says where it is", () => {
		const { drawn, renders } = panel(SESSION, { rows: 14 });
		const first = drawn.render(80);
		expect(first.length).toBeLessThanOrEqual(Math.floor(14 * 0.8));
		expect(first.at(-1)).toMatch(/↑↓ scroll {3}esc close ─+ 1-\d+ of \d+ ─╯$/);
		drawn.handleInput("\u001b[B");
		expect(renders()).toBe(1);
		expect(drawn.render(80).at(-1)).toMatch(/ 2-\d+ of \d+ ─╯$/);
		// Past the end, the key does nothing and nothing redraws.
		for (let step = 0; step < 50; step++) drawn.handleInput("j");
		drawn.render(80);
		const before = renders();
		drawn.handleInput("j");
		expect(renders()).toBe(before);
	});

	test("escape, q and Alt+T close it", () => {
		for (const key of ["\u001b", "q", "\u001bt"]) {
			const { drawn, closed } = panel(SESSION);
			drawn.handleInput(key);
			expect(closed()).toBe(true);
		}
	});
});

test("the tool answers the model with the board's text, not the panel's drawing", () => {
	const long = "a title long enough that the panel would cut it somewhere in the middle of a word";
	const written = boardText({
		...emptyBoard(),
		cards: [{ id: "c1", title: long, column: "todo", at: 1 }],
	});
	expect(written).toContain(long);
	expect(written).not.toContain("\u2026");
});
