import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

// The board as the panel draws it: one line per open card, the column first, so a card that moves
// changes its own line and no other line changes place. The words come from the kit: the column is
// its name and the blocker is the one translation, so the panel cannot disagree with the board.
import { CUT } from "../ui/glyphs.ts";
import { blockedText, type BoardCard, type BoardColumn, type BoardView } from "./model.ts";

/** The open columns, widest word first, so the column is a fixed-width field and titles never move. */
const COLUMNS: readonly BoardColumn[] = ["todo", "doing", "review"];
const WIDTH = Math.max(...COLUMNS.map((column) => column.length));

/** What the panel shows of the board: the open cards, the backlog's count and the last done. */
export function boardLines(
	view: BoardView | undefined,
	theme: Theme,
	width: number,
	reader: "operator" | "agent",
): string[] {
	if (view === undefined) return [];
	const head = theme.fg(
		"dim",
		`board  ${view.open.length} open · ${view.backlog} in the backlog · ${view.done.length} done`,
	);
	const lines = view.open.map((card) => cardLine(card, theme, width, reader));
	return [truncateToWidth(head, width, CUT), ...lines];
}

/** One card: the column, what it is, and the one fact that goes with its column. */
function cardLine(
	card: BoardCard,
	theme: Theme,
	width: number,
	reader: "operator" | "agent",
): string {
	const column = card.column.padEnd(WIDTH);
	const rest = width - WIDTH - 2;
	const what = [theme.bold(card.title)];
	if (card.pr !== undefined) what.push(theme.fg("dim", `#${card.pr}`));
	const fact = factOf(card, reader);
	if (fact !== undefined) what.push(theme.fg("muted", fact));
	const body = truncateToWidth(what.join(" "), Math.max(1, rest), CUT);
	const left = `${theme.fg("dim", column)} ${body}`;
	// The name never moves: the column field is the same width in every mode, measured the way the
	// screen measures it, so a wider word cannot push the title.
	return left;
}

function factOf(card: BoardCard, reader: "operator" | "agent"): string | undefined {
	if (card.column === "doing" && card.now !== undefined) return `· ${card.now}`;
	if (card.column === "review" && card.reviewer !== undefined) return `· @${card.reviewer}`;
	if (card.blocked !== undefined) return `· ${blockedText(card.blocked, reader)}`;
	return undefined;
}
