import { type BoardView, type SessionState } from "@adeildo/pi-remote-protocol";
import { type ReactNode } from "react";

import { boardCards, terminalWait } from "./panel-data.ts";

/** Absent draws nothing, which is not an empty board. */
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

export function TerminalWait({ prompt }: { prompt: SessionState["prompt"] }): ReactNode {
	const line = terminalWait(prompt);
	if (line === undefined) return null;
	return (
		<p role="status" className="terminal-wait">
			{line}
		</p>
	);
}
