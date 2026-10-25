// What the Alt+T panel shows: one line per card, the column word in a fixed width so a card that
// moves column keeps its title where the reader's eye is.
import { blockedText, type Board, type BoardCard } from "./model.ts";

const COLUMN = 8;

function line(card: BoardCard): string {
	const column = card.column.padEnd(COLUMN);
	const now = card.now === undefined ? "" : ` ${card.now}`;
	const blocked = card.blocked === undefined ? "" : ` (${blockedText(card.blocked, "operator")})`;
	return `${column} ${card.title}${now}${blocked}`;
}

/** The board as terminal lines, oldest card first. */
export function boardLines(board: Board): string[] {
	return board.cards.map(line);
}
