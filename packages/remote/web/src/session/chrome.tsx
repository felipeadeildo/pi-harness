// The chrome beside the transcript: what the session is doing and what it waits on.
import { type BoardView, type SessionState } from "@adeildo/pi-remote-protocol";
import { type ReactNode } from "react";

import { boardCards, terminalWait } from "./panel-data.ts";

/** The board the session keeps, as cards: absent means nothing is drawn, not an empty board. */
export function Board({ board }: { board: BoardView | undefined }): ReactNode {
	const cards = boardCards(board);
	if (cards === undefined) return null;
	return (
		<section className="board">
			<h2>Board</h2>
			{cards.map((card) => (
				<p key={card.id}>{card.line}</p>
			))}
		</section>
	);
}

/** The terminal is waiting on a dialog this page cannot answer: it says so, and where to go. */
export function TerminalWait({ prompt }: { prompt: SessionState["prompt"] }): ReactNode {
	const line = terminalWait(prompt);
	if (line === undefined) return null;
	return (
		<p role="status" className="terminal-wait">
			{line}
		</p>
	);
}
