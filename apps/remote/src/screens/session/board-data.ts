// The board a session keeps, as lines a screen can draw: the open cards in the order the writer sent,
// the column each is in, and the blocker said in the reader's words. Absent is absent, not empty.
import type { BoardBlocker, BoardView } from "@adeildo/pi-remote-protocol";

/** One card as a line: what it is, where it stands, and what waits, if anything. */
interface BoardLine {
	id: string;
	title: string;
	column: string;
	/** The blocker in the reader's words, and nothing when the card is not blocked. */
	blocked?: string;
}

/** The cards a phone shows, and what the rest of the board counts. */
export interface BoardLines {
	open: BoardLine[];
	backlog: number;
	done: number;
}

export function boardLinesOf(board: BoardView | undefined): BoardLines | undefined {
	// No board is not an empty board: drawing one would tell the person the agent has nothing, which is
	// a claim nobody made.
	if (board === undefined) return undefined;
	return {
		open: board.open.map((card) => ({
			id: card.id,
			title: card.title,
			column: card.column,
			...(card.blocked === undefined ? {} : { blocked: blockedInWords(card.blocked) }),
		})),
		backlog: board.backlog,
		done: board.done.length,
	};
}

/**
 * A blocker in the words of the person reading this phone. The stored value says `operator` and never
 * depends on who reads it; the translation happens here, which is the only place that knows the reader.
 */
function blockedInWords(blocker: BoardBlocker): string {
	if (blocker.on === "operator") return `você: ${blocker.why}`;
	if (blocker.on === "outside") return `fora: ${blocker.why}`;
	const handle = blocker.handle.startsWith("@") ? blocker.handle : `@${blocker.handle}`;
	return `${handle}: ${blocker.why}`;
}
