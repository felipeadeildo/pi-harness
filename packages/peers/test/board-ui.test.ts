// The board in the panel: one line per open card, the column first, so a card that moves changes its
// own line and no other line changes place.
import { describe, expect, test } from "bun:test";

import type { BoardCard, BoardView } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { boardLines } from "../src/ui/board.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function card(id: string, at: number, rest: Partial<BoardCard> = {}): BoardCard {
	return { id, title: `card ${id}`, column: "todo", at, ...rest };
}

const view = (cards: BoardCard[]): BoardView => ({ open: cards, backlog: 3, done: [] });

describe("the board in the panel", () => {
	test("draws every open card once, oldest first, with the two counts", () => {
		const lines = boardLines(
			// The ids run opposite to the arrival order, so sorting by id would be seen.
			view([card("c1", 20, { column: "doing", now: "writing the test" }), card("c2", 10)]),
			plain,
			80,
		);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("2 open");
		expect(lines[1]).toContain("card c2");
		expect(lines[2]).toContain("writing the test");
	});

	test("the title keeps its column when a card changes column", () => {
		const at = (column: BoardCard["column"]): number => {
			const line = boardLines(view([card("c1", 10, { column })]), plain, 80)[1] ?? "";
			return visibleWidth(line.split("card c1")[0] ?? "");
		};
		expect(at("todo")).toBe(at("doing"));
		expect(at("review")).toBe(at("doing"));
	});

	test("the blocker is the kit's sentence for this reader", () => {
		const blocked = card("c1", 10, { blocked: { on: "operator", why: "the setting's name" } });
		expect(boardLines(view([blocked]), plain, 80)[1]).toContain("você: the setting's name");
	});

	test("with no board it draws nothing, and every line fits", () => {
		expect(boardLines(undefined, plain, 40)).toEqual([]);
		const lines = boardLines(view([card("c1", 10, { pr: 188 })]), plain, 30);
		expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
	});
});

test("the tool answers the model with the board's text, not the panel's drawing", async () => {
	const { boardText } = await import("@adeildo/pi-kit");
	const long = "a title long enough that the panel would cut it somewhere in the middle of a word";
	const { emptyBoard } = await import("@adeildo/pi-kit");
	const written = boardText({
		...emptyBoard(),
		cards: [{ id: "c1", title: long, column: "todo", at: 1 }],
	});
	expect(written).toContain(long);
	expect(written).not.toContain("\u2026");
});
