// The board as the panel draws it: one line per open card, the column first. A card that moves changes
// its own line and no other line changes place, and the blocker is the kit's one translation.
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
	test("draws every open card once, oldest first, with the backlog and done counts", () => {
		const lines = boardLines(
			view([card("c2", 20, { column: "doing", now: "writing the test" }), card("c1", 10)]),
			plain,
			80,
		);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("2 open");
		expect(lines[0]).toContain("3 in the backlog");
		expect(lines[1]).toContain("card c1");
		expect(lines[2]).toContain("card c2");
		expect(lines[2]).toContain("writing the test");
	});

	test("the column is a fixed width, so a title never moves when a card changes column", () => {
		// The property is the column of the title on screen, measured the way the screen measures.
		const at = (column: BoardCard["column"]): number =>
			visibleWidth(
				boardLines(view([card("c1", 10, { column })]), plain, 80)[1]?.split("card c1")[0] ?? "",
			);
		expect(at("todo")).toBe(at("doing"));
		expect(at("review")).toBe(at("doing"));
	});

	test("the blocker is the kit's sentence for this reader", () => {
		const blocked = card("c1", 10, {
			blocked: { on: "operator", why: "the name of the setting" },
		});
		expect(boardLines(view([blocked]), plain, 80)[1]).toContain("você: the name of the setting");
		const other = card("c2", 20, { blocked: { on: "agent", handle: "badger", why: "a review" } });
		expect(boardLines(view([other]), plain, 80)[1]).toContain("@badger: a review");
	});

	test("with no board, it draws nothing, and every line fits the width", () => {
		expect(boardLines(undefined, plain, 40)).toEqual([]);
		const lines = boardLines(view([card("c1", 10, { pr: 188 })]), plain, 30);
		expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
	});
});
