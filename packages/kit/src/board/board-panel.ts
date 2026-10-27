import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// The Alt+T board. It only reads; the agent writes the board with the tool.
import { FRAME_X, FRAME_Y, frame, type KeyHint } from "../ui/frame.ts";
import { GLYPH, LINE } from "../ui/glyphs.ts";
import {
	BOARD_COLUMNS,
	blockedText,
	type Board,
	type BoardCard,
	type BoardColumn,
	emptyBoard,
} from "./model.ts";

/** The columns on the board, in the order the work moves through them. */
const LANES: readonly BoardColumn[] = ["doing", "review", "todo", "done"];
/** Done grows without end; the board shows the newest. */
const DONE_SHOWN = 6;
const GAP = 2;
/** Below this width a column cannot hold a card's words, and the columns stack. */
const LANE_MIN = 22;
const TITLE_LINES = 3;
const DETAIL_LINES = 2;
const CUT = "\u2026";

const MARKS: Record<BoardColumn, [string, ThemeColor]> = {
	doing: [GLYPH.diamond, "accent"],
	review: [GLYPH.ring, "accent"],
	todo: [GLYPH.diamondEmpty, "muted"],
	backlog: [GLYPH.ringDotted, "dim"],
	done: [GLYPH.check, "success"],
	dropped: [GLYPH.times, "dim"],
};
/** A card that waits wears the flag, whatever its column. */
const WAITING: [string, ThemeColor] = [GLYPH.flag, "warning"];

interface Lane {
	column: BoardColumn;
	cards: BoardCard[];
	/** All the cards in the column, when it shows only the newest. */
	total: number;
}

export interface BoardPanelOptions {
	theme: Theme;
	close: () => void;
	requestRender: () => void;
	read?: () => Board;
	rows?: () => number;
	now?: () => number;
}

export class BoardPanel implements Component {
	readonly #options: BoardPanelOptions;
	/** The card under the cursor, by id, so a board that changes keeps it. */
	#chosen: string | undefined;
	#reading = false;
	/** The first board row shown, kept between drawings so the view does not jump. */
	#top = 0;

	constructor(options: BoardPanelOptions) {
		this.#options = options;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { theme } = this.#options;
		const board = this.#board();
		const lanes = lanesOf(board);
		const chosen = this.#card(lanes);
		const inner = Math.max(20, width - FRAME_X);
		const height = Math.max(6, (this.#options.rows?.() ?? 24) - FRAME_Y);
		const now = (this.#options.now ?? Date.now)();
		const status = theme.fg("dim", countsOf(board));
		if (this.#reading && chosen !== undefined)
			return frame(theme, width, fit(cardPage(chosen, theme, inner, now), height), {
				title: "Board",
				status,
				keys: [["esc", "back"]],
				border: "borderMuted",
			});

		const foot = footLines(board, theme, inner);
		// One empty line above the columns and one above the foot.
		const room = Math.max(3, height - foot.length - 2);
		const drawn = lanesLines(lanes, chosen?.id, theme, inner);
		const empty = lanes.every((lane) => lane.cards.length === 0);
		const body = empty ? emptyLines(theme, inner) : this.#scrolled(drawn.lines, drawn.chosen, room);
		const above = !empty && this.#top > 0;
		const below = !empty && this.#top + room < drawn.lines.length;
		return frame(theme, width, ["", ...fit(body, room), "", ...foot], {
			title: "Board",
			status,
			keys: this.#keys(empty),
			footnote: theme.fg("dim", moreText(above, below)),
			border: "borderMuted",
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") && this.#reading)
			return this.#set(() => (this.#reading = false));
		if (matchesKey(data, "escape") || matchesKey(data, "alt+t") || data === "q")
			return this.#options.close();
		if (this.#reading) return;
		const lanes = lanesOf(this.#board());
		const chosen = this.#card(lanes);
		if (matchesKey(data, "enter") && chosen !== undefined)
			return this.#set(() => (this.#reading = true));
		const next = moved(lanes, chosen, data);
		if (next === undefined || next.id === chosen?.id) return;
		this.#set(() => (this.#chosen = next.id));
	}

	#set(change: () => void): void {
		change();
		this.#options.requestRender();
	}

	#board(): Board {
		return this.#options.read?.() ?? emptyBoard();
	}

	/** The chosen card; the first of the first column that has one when it is gone. */
	#card(lanes: readonly Lane[]): BoardCard | undefined {
		const cards = lanes.flatMap((lane) => lane.cards);
		const card = cards.find((one) => one.id === this.#chosen) ?? cards[0];
		this.#chosen = card?.id;
		return card;
	}

	/** Moves only as far as it must to keep the chosen card's box in sight. */
	#scrolled(
		lines: readonly string[],
		chosen: { from: number; to: number },
		room: number,
	): string[] {
		const most = Math.max(0, lines.length - room);
		if (chosen.from < this.#top) this.#top = chosen.from;
		if (chosen.to >= this.#top + room) this.#top = chosen.to - room + 1;
		this.#top = Math.max(0, Math.min(this.#top, most));
		return lines.slice(this.#top, this.#top + room);
	}

	#keys(empty: boolean): KeyHint[] {
		if (empty) return [["esc", "close"]];
		return [
			[`${GLYPH.left}${GLYPH.right}${GLYPH.up}${GLYPH.down}`, "move"],
			["enter", "open"],
			["esc", "close"],
		];
	}
}

function lanesOf(board: Board): Lane[] {
	return LANES.map((column) => {
		const cards = board.cards.filter((card) => card.column === column);
		if (column !== "done") return { column, cards, total: cards.length };
		return { column, cards: cards.toReversed().slice(0, DONE_SHOWN), total: cards.length };
	});
}

/** The next card for an arrow key: up and down inside a column, left and right to the nearest column with cards. */
function moved(
	lanes: readonly Lane[],
	chosen: BoardCard | undefined,
	data: string,
): BoardCard | undefined {
	if (chosen === undefined) return undefined;
	const lane = lanes.findIndex((one) => one.cards.some((card) => card.id === chosen.id));
	const row = lanes[lane]?.cards.findIndex((card) => card.id === chosen.id) ?? 0;
	const vertical =
		matchesKey(data, "up") || data === "k" ? -1 : matchesKey(data, "down") || data === "j" ? 1 : 0;
	if (vertical !== 0) return lanes[lane]?.cards[row + vertical];
	const across =
		matchesKey(data, "left") || data === "h"
			? -1
			: matchesKey(data, "right") || data === "l"
				? 1
				: 0;
	if (across === 0) return undefined;
	for (let at = lane + across; at >= 0 && at < lanes.length; at += across) {
		const cards = lanes[at]?.cards ?? [];
		if (cards.length > 0) return cards[Math.min(row, cards.length - 1)];
	}
	return undefined;
}

function countsOf(board: Board): string {
	const count = (test: (card: BoardCard) => boolean): number => board.cards.filter(test).length;
	const parts = [`${count((card) => ["doing", "review", "todo"].includes(card.column))} open`];
	const waiting = count((card) => card.blocked !== undefined && card.column !== "done");
	if (waiting > 0) parts.push(`${waiting} waiting`);
	const done = count((card) => card.column === "done");
	if (done > 0) parts.push(`${done} done`);
	return parts.join("   ");
}

/** The board scrolls with the chosen card, so the foot says when it goes on past the screen. */
function moreText(above: boolean, below: boolean): string {
	if (above && below) return `${GLYPH.up}${GLYPH.down} more`;
	if (above) return `${GLYPH.up} more above`;
	if (below) return `${GLYPH.down} more below`;
	return "";
}

/** The columns side by side, or one under another when the terminal is too narrow for four. */
function lanesLines(
	lanes: readonly Lane[],
	chosen: string | undefined,
	theme: Theme,
	inner: number,
): { lines: string[]; chosen: { from: number; to: number } } {
	const beside = Math.floor((inner - GAP * (lanes.length - 1)) / lanes.length) >= LANE_MIN;
	if (!beside) {
		const lines: string[] = [];
		let at = { from: 0, to: 0 };
		for (const lane of lanes) {
			if (lines.length > 0) lines.push("");
			const drawn = laneLines(lane, chosen, theme, inner);
			if (drawn.chosen !== undefined)
				at = { from: lines.length + drawn.chosen.from, to: lines.length + drawn.chosen.to };
			lines.push(...drawn.lines);
		}
		return { lines, chosen: at };
	}
	const width = Math.floor((inner - GAP * (lanes.length - 1)) / lanes.length);
	const drawn = lanes.map((lane) => laneLines(lane, chosen, theme, width));
	const tallest = Math.max(...drawn.map((one) => one.lines.length));
	const lines: string[] = [];
	for (let row = 0; row < tallest; row++)
		lines.push(drawn.map((one) => one.lines[row] ?? " ".repeat(width)).join(" ".repeat(GAP)));
	const at = drawn.find((one) => one.chosen !== undefined)?.chosen ?? { from: 0, to: 0 };
	return { lines, chosen: at };
}

/** A column's heading and its cards' boxes, every line exactly `width` wide. */
function laneLines(
	lane: Lane,
	chosen: string | undefined,
	theme: Theme,
	width: number,
): { lines: string[]; chosen?: { from: number; to: number } } {
	const label = BOARD_COLUMNS.find((one) => one.column === lane.column)?.label ?? lane.column;
	const [mark, color] = MARKS[lane.column];
	const count =
		lane.total === lane.cards.length ? `${lane.total}` : `${lane.cards.length} of ${lane.total}`;
	const here = lane.cards.some((card) => card.id === chosen);
	const name = here ? theme.bold(label) : theme.fg("muted", label);
	const lines = [pad(`${theme.fg(color, mark)} ${name} ${theme.fg("dim", count)}`, width)];
	if (lane.cards.length === 0)
		return { lines: [...lines, pad(theme.fg("dim", "  nothing here"), width)] };
	let at: { from: number; to: number } | undefined;
	for (const card of lane.cards) {
		const box = boxLines(card, card.id === chosen, theme, width);
		if (card.id === chosen) at = { from: lines.length, to: lines.length + box.length - 1 };
		lines.push(...box);
	}
	return at === undefined ? { lines } : { lines, chosen: at };
}

function boxLines(card: BoardCard, chosen: boolean, theme: Theme, width: number): string[] {
	const inner = Math.max(4, width - 4);
	const [mark, color] = card.blocked === undefined ? MARKS[card.column] : WAITING;
	const edge: ThemeColor = chosen
		? "accent"
		: card.blocked === undefined
			? "borderMuted"
			: "warning";
	// The chosen card is drawn heavy, so it stands out by its shape and not only by its color.
	const [h, v, tl, tr, bl, br] = chosen
		? [
				LINE.hHeavy,
				LINE.vHeavy,
				LINE.topLeftHeavy,
				LINE.topRightHeavy,
				LINE.bottomLeftHeavy,
				LINE.bottomRightHeavy,
			]
		: [LINE.h, LINE.v, LINE.topLeft, LINE.topRight, LINE.bottomLeft, LINE.bottomRight];
	const pr = card.pr === undefined ? "" : ` ${theme.fg("dim", `#${card.pr}`)}`;
	const title = clipped(
		wrapTextWithAnsi(`${card.title}${pr}`, inner - 2).map((line, index) =>
			index === 0
				? `${theme.fg(color, mark)} ${chosen ? theme.bold(line) : line}`
				: `  ${chosen ? theme.bold(line) : line}`,
		),
		TITLE_LINES,
		inner,
	);
	const said = detailOf(card, theme);
	const detail =
		said === undefined
			? []
			: clipped(
					wrapTextWithAnsi(said, inner - 2).map((line) => `  ${line}`),
					DETAIL_LINES,
					inner,
				);
	const side = theme.fg(edge, v);
	const row = (text: string): string => `${side} ${pad(text, inner)} ${side}`;
	return [
		theme.fg(edge, `${tl}${h.repeat(width - 2)}${tr}`),
		...title.map(row),
		...detail.map(row),
		theme.fg(edge, `${bl}${h.repeat(width - 2)}${br}`),
	];
}

function detailOf(card: BoardCard, theme: Theme): string | undefined {
	if (card.blocked !== undefined) return theme.fg("warning", blockedText(card.blocked, "operator"));
	if (card.column === "review" && card.reviewer !== undefined)
		return theme.fg("muted", `@${card.reviewer.replace(/^@/, "")} reviews`);
	if (card.column === "done")
		return card.result === undefined ? undefined : theme.fg("dim", card.result);
	return card.now === undefined ? undefined : theme.fg("muted", card.now);
}

function footLines(board: Board, theme: Theme, inner: number): string[] {
	const lines: string[] = [];
	const backlog = board.cards.filter((card) => card.column === "backlog");
	if (backlog.length > 0) {
		const [mark, color] = MARKS.backlog;
		const titles = backlog.map((card) => theme.fg("muted", card.title)).join(theme.fg("dim", ", "));
		lines.push(
			truncateToWidth(
				`${theme.fg(color, mark)} ${theme.bold("Backlog")} ${theme.fg("dim", String(backlog.length))}  ${titles}`,
				inner,
				CUT,
			),
		);
	}
	const last = board.decisions.at(-1);
	if (last !== undefined)
		lines.push(
			truncateToWidth(
				`${theme.fg("dim", GLYPH.chevron)} ${theme.bold("Decided")} ${theme.fg("dim", String(board.decisions.length))}  ${theme.fg("muted", last.text)}`,
				inner,
				CUT,
			),
		);
	return lines;
}

/** The chosen card in full, every field it has under a quiet label. */
function cardPage(card: BoardCard, theme: Theme, width: number, now: number): string[] {
	const wrap = (text: string): string[] => wrapTextWithAnsi(text, Math.max(1, Math.min(width, 80)));
	const field = (label: string, text: string | undefined, color: ThemeColor): string[] =>
		text === undefined || text === ""
			? []
			: ["", theme.fg("dim", label), ...wrap(theme.fg(color, text))];
	const [mark, color] = card.blocked === undefined ? MARKS[card.column] : WAITING;
	const label = BOARD_COLUMNS.find((one) => one.column === card.column)?.label ?? card.column;
	const meta = [
		`${theme.fg(color, mark)} ${theme.fg(color === "dim" ? "muted" : color, label)}`,
		...(card.pr === undefined ? [] : [theme.fg("muted", `#${card.pr}`)]),
		theme.fg("dim", `changed ${ago(card.at, now)}`),
	].join("   ");
	const reviewer = card.reviewer === undefined ? undefined : `@${card.reviewer.replace(/^@/, "")}`;
	const blocked = card.blocked === undefined ? undefined : blockedText(card.blocked, "operator");
	return [
		"",
		...wrap(theme.bold(card.title)),
		meta,
		...field("Waits on", blocked, "warning"),
		...field("Where it stands", card.now, "text"),
		...field("Reviewer", reviewer, "text"),
		...field("Result", card.result, "text"),
		...field("Why it was dropped", card.why, "text"),
	];
}

function emptyLines(theme: Theme, inner: number): string[] {
	return [
		"",
		...wrapTextWithAnsi(
			theme.fg(
				"muted",
				"Nothing on the board yet. The agent adds a card when it takes on a deliverable.",
			),
			inner,
		),
	];
}

/** At most `most` lines, the last one cut short when there were more. */
function clipped(lines: readonly string[], most: number, width: number): string[] {
	if (lines.length <= most) return [...lines];
	const kept = lines.slice(0, most);
	kept[most - 1] = truncateToWidth(`${kept[most - 1] ?? ""}${CUT}`, width, CUT);
	return kept;
}

function pad(text: string, width: number): string {
	const shown = truncateToWidth(text, width, CUT);
	return `${shown}${" ".repeat(Math.max(0, width - visibleWidth(shown)))}`;
}

/** Exactly `height` lines, so the foot stays at the bottom of the screen. */
function fit(lines: readonly string[], height: number): string[] {
	return [
		...lines.slice(0, height),
		...Array.from({ length: Math.max(0, height - lines.length) }, () => ""),
	];
}

function ago(at: number, now: number): string {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
