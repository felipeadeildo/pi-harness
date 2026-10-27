import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// The Alt+T panel reads the board in the kit's frame: the open cards under their column, then what
// was delivered and decided. It only reads; the agent writes the board with the tool.
import { FRAME_Y, frame, frameInner, type KeyHint } from "../ui/frame.ts";
import { GLYPH } from "../ui/glyphs.ts";
import {
	BOARD_COLUMNS,
	blockedText,
	type Board,
	type BoardCard,
	type BoardColumn,
	boardView,
	emptyBoard,
} from "./model.ts";

/** The decisions shown, newest last; `find` reaches the rest. */
const DECISIONS = 3;
/** The rows the overlay leaves to the terminal, matching its 80% height. */
const HEIGHT_SHARE = 0.8;
const MIN_BODY = 4;
/** The detail under a title starts under the title's words. */
const INDENT = "  ";

export interface BoardPanelOptions {
	theme: Theme;
	close: () => void;
	requestRender: () => void;
	read?: () => Board;
	/** The terminal's height; without it the panel never scrolls. */
	rows?: () => number;
}

export class BoardPanel implements Component {
	readonly #options: BoardPanelOptions;
	#scroll = 0;
	/** Lines below the shown ones, from the last drawing, so a key knows how far it may go. */
	#below = 0;

	constructor(options: BoardPanelOptions) {
		this.#options = options;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { theme } = this.#options;
		const board = this.#options.read?.() ?? emptyBoard();
		const body = boardBody(board, theme, frameInner(width));
		const room = this.#room();
		const scrolls = body.length > room;
		this.#scroll = scrolls ? Math.min(this.#scroll, body.length - room) : 0;
		const shown = scrolls ? body.slice(this.#scroll, this.#scroll + room) : body;
		this.#below = scrolls ? body.length - this.#scroll - room : 0;
		const keys: KeyHint[] = scrolls
			? [
					["↑↓", "scroll"],
					["esc", "close"],
				]
			: [["esc", "close"]];
		return frame(theme, width, ["", ...shown, ""], {
			title: "Board",
			status: theme.fg("dim", countsOf(board)),
			keys,
			...(scrolls
				? {
						footnote: theme.fg(
							"dim",
							`${this.#scroll + 1}-${this.#scroll + room} of ${body.length}`,
						),
					}
				: {}),
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "alt+t") || data === "q") {
			this.#options.close();
			return;
		}
		const step = stepOf(data, this.#room());
		if (step === 0) return;
		const next = Math.max(0, Math.min(this.#scroll + step, this.#scroll + this.#below));
		if (next === this.#scroll) return;
		this.#scroll = next;
		this.#options.requestRender();
	}

	/** Body rows inside the frame: the overlay's share of the terminal, less the edges and padding. */
	#room(): number {
		const rows = this.#options.rows?.();
		if (rows === undefined) return Number.MAX_SAFE_INTEGER;
		return Math.max(MIN_BODY, Math.floor(rows * HEIGHT_SHARE) - FRAME_Y - 2);
	}
}

function stepOf(data: string, page: number): number {
	if (matchesKey(data, "up") || data === "k") return -1;
	if (matchesKey(data, "down") || data === "j") return 1;
	if (matchesKey(data, "pageUp")) return -page;
	if (matchesKey(data, "pageDown")) return page;
	return 0;
}

function countsOf(board: Board): string {
	const view = boardView(board);
	const parts = [`${view.open.length} open`];
	if (view.backlog > 0) parts.push(`${view.backlog} in the backlog`);
	const done = board.cards.filter((card) => card.column === "done").length;
	if (done > 0) parts.push(`${done} done`);
	return parts.join("   ");
}

/** Every line inside the frame, before the panel cuts it to the terminal's height. */
function boardBody(board: Board, theme: Theme, inner: number): string[] {
	const view = boardView(board);
	const decisions = board.decisions.slice(-DECISIONS);
	if (view.open.length === 0 && view.done.length === 0 && decisions.length === 0)
		return wrapTextWithAnsi(
			theme.fg(
				"muted",
				"Nothing on the board yet. The agent adds a card when it takes on a deliverable.",
			),
			inner,
		);
	const sections: string[][] = [];
	for (const { column, label, open } of BOARD_COLUMNS) {
		if (!open) continue;
		const cards = view.open.filter((card) => card.column === column);
		if (cards.length === 0) continue;
		sections.push([
			heading(theme, label, cards.length),
			...cards.flatMap((card) => cardLines(card, theme, inner)),
		]);
	}
	if (view.done.length > 0)
		sections.push([
			heading(theme, "Done lately", view.done.length),
			...view.done.flatMap((card) => cardLines(card, theme, inner)),
		]);
	if (decisions.length > 0)
		sections.push([
			heading(theme, "Decisions", board.decisions.length),
			...decisions.flatMap((decision) =>
				wrapped(`${theme.fg("dim", GLYPH.chevron)} ${decision.text}`, inner, INDENT),
			),
		]);
	// One empty line between sections.
	return sections.flatMap((section, index) => (index === 0 ? section : [""].concat(section)));
}

function heading(theme: Theme, label: string, count: number): string {
	return `${theme.bold(theme.fg("muted", label))} ${theme.fg("dim", String(count))}`;
}

/** The mark says the column, or that the card waits; the line under the title says on what. */
function cardLines(card: BoardCard, theme: Theme, inner: number): string[] {
	const [mark, color] = markOf(card);
	const pr = card.pr === undefined ? "" : `  ${theme.fg("dim", `#${card.pr}`)}`;
	const title = wrapped(`${theme.fg(color, mark)} ${theme.bold(card.title)}${pr}`, inner, INDENT);
	const detail = detailOf(card, theme);
	if (detail === undefined) return title;
	const under = wrapTextWithAnsi(detail, Math.max(1, inner - INDENT.length));
	return [...title, ...under.map((line) => `${INDENT}${line}`)];
}

function markOf(card: BoardCard): [string, ThemeColor] {
	if (card.blocked !== undefined) return [GLYPH.flag, "warning"];
	const marks: Record<BoardColumn, [string, ThemeColor]> = {
		doing: [GLYPH.diamond, "accent"],
		review: [GLYPH.ring, "accent"],
		todo: [GLYPH.diamondEmpty, "dim"],
		backlog: [GLYPH.diamondEmpty, "dim"],
		done: [GLYPH.check, "success"],
		dropped: [GLYPH.times, "dim"],
	};
	return marks[card.column];
}

function detailOf(card: BoardCard, theme: Theme): string | undefined {
	if (card.blocked !== undefined) return theme.fg("warning", blockedText(card.blocked, "operator"));
	if (card.column === "doing" && card.now !== undefined) return theme.fg("muted", card.now);
	if (card.column === "review" && card.reviewer !== undefined)
		return theme.fg("muted", `@${card.reviewer.replace(/^@/, "")} reviews`);
	if (card.column === "done" && card.result !== undefined) return theme.fg("dim", card.result);
	return undefined;
}

/** A long line wraps under its own words, never under the mark. */
function wrapped(text: string, inner: number, indent: string): string[] {
	return wrapTextWithAnsi(text, Math.max(1, inner - indent.length)).map((line, index) =>
		index === 0 ? line : `${indent}${line}`,
	);
}
