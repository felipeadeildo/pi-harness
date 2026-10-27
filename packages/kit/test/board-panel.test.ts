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

/** The words of one row of boxes, without the borders, so a test reads a card as text. */
function words(lines: readonly string[]): string {
	return lines.map((line) => line.replace(/[\u2500-\u257f]/g, " ").replace(/ +/g, " ")).join("\n");
}

describe("the board panel", () => {
	test("fills the terminal in the frame, with the counts on top and the keys at the bottom", () => {
		const lines = panel(SESSION, { rows: 30 }).drawn.render(120);
		expect(lines).toHaveLength(30);
		expect(lines[0]).toMatch(/^╭─ Board ─+ 3 open {3}1 waiting {3}1 done ─╮$/);
		expect(lines.at(-1)).toMatch(/^╰─ .+ move {3}enter open {3}esc close ─+╯$/);
		expect(lines.every((line) => visibleWidth(line) === 120)).toBe(true);
	});

	test("draws a column per stage side by side, each card in its own box", () => {
		const lines = panel(SESSION, { rows: 30 }).drawn.render(120);
		const heads = lines.find((line) => line.includes("Doing")) ?? "";
		const order = ["Doing 1", "In review 1", "To do 1", "Done 1"].map((label) =>
			heads.indexOf(label),
		);
		expect(order.every((at) => at > 0)).toBe(true);
		expect(order).toEqual(order.toSorted((a, b) => a - b));
		const text = words(lines);
		expect(text).toContain("One secret with an");
		expect(text).toContain("auth mode #41");
		expect(text).toContain("@badger reviews");
		expect(text).toContain("the Workers OAuth");
		expect(lines.filter((line) => line.includes("\u256d")).length).toBeGreaterThan(1);
	});

	test("the backlog and the last decision sit in the foot", () => {
		const lines = panel(SESSION, { rows: 30 }).drawn.render(120);
		expect(lines.at(-3)).toContain("Backlog 1  Write the release notes");
		expect(lines.at(-2)).toContain("Decided 1  One SECRET with a mode");
	});

	test("a card that waits wears the warning color on its box and says what it waits on", () => {
		const lines = panel(SESSION, { theme: marked, rows: 30 }).drawn.render(120);
		expect(lines.join("\n")).toContain("<w>você: production");
		expect(lines.some((line) => line.includes("<w>\u256d"))).toBe(true);
	});

	test("the arrows move across columns and down a column, and enter opens the card in full", () => {
		const { drawn } = panel(SESSION, { rows: 30 });
		drawn.handleInput("\u001b[C");
		drawn.handleInput("\r");
		const page = drawn.render(120).join("\n");
		expect(page).toContain("Reviewer");
		expect(page).toContain("@badger");
		expect(page).toContain("esc back");
		drawn.handleInput("\u001b");
		expect(drawn.render(120).join("\n")).toContain("enter open");
	});

	test("a narrow terminal stacks the columns", () => {
		const lines = panel(SESSION, { rows: 60 }).drawn.render(60);
		expect(lines.filter((line) => /Doing|In review|To do|Done/.test(line))).toHaveLength(4);
		expect(lines.every((line) => visibleWidth(line) === 60)).toBe(true);
	});

	test("an empty board says what fills it", () => {
		expect(panel(emptyBoard()).drawn.render(80).join("\n")).toContain("Nothing on the board yet");
	});

	test("a column taller than the terminal follows the chosen card", () => {
		const tall = applied(
			...Array.from({ length: 12 }, (_, index): BoardOp => ({
				op: "add",
				title: `Card number ${index + 1}`,
				column: "todo",
				at: index + 1,
			})),
		);
		const { drawn } = panel(tall, { rows: 20 });
		const first = drawn.render(120).join("\n");
		expect(first).not.toContain("Card number 12");
		expect(first).toContain("\u2193 more below");
		for (let step = 0; step < 11; step++) drawn.handleInput("j");
		const text = drawn.render(120).join("\n");
		expect(text).toContain("Card number 12");
		expect(text).not.toContain("Card number 1 ");
		expect(text).toContain("\u2191 more above");
	});

	test("the chosen card is drawn heavy, and only it", () => {
		const two = applied(
			{ op: "add", title: "First", column: "todo", at: 1 },
			{ op: "add", title: "Second", column: "todo", at: 2 },
		);
		const lines = panel(two).drawn.render(120);
		const heavy = lines.filter((line) => line.includes("\u250f"));
		expect(heavy).toHaveLength(1);
		expect(lines[lines.indexOf(heavy[0] ?? "") + 1]).toContain("First");
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
