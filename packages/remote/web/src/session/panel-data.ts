// What the chrome lists, apart from the views, so a test can read it.
import {
	type BoardCard,
	type BoardView,
	blockedOf,
	type SessionState,
} from "@adeildo/pi-remote-protocol";

import { plain } from "./plain.ts";

/** In the writer's order; the screen does not sort. */
export function boardCards(
	board: BoardView | undefined,
): { id: string; line: string }[] | undefined {
	if (board === undefined) return undefined;
	return board.open.map((card) => ({
		id: card.id,
		line: [card.column, plain(card.title), factOf(card)].filter((one) => one !== "").join(" · "),
	}));
}

function factOf(card: BoardCard): string {
	if (card.blocked !== undefined) return blockedOf(card.blocked, "operator");
	if (card.reviewer !== undefined) return `review: ${card.reviewer}`;
	return "";
}

/** The title comes from another extension, so it goes through `plain`. */
export function terminalWait(prompt: SessionState["prompt"]): string | undefined {
	if (prompt === undefined) return undefined;
	const title = prompt.title === undefined ? "" : plain(prompt.title).trim();
	if (title !== "") return `Waiting in the terminal: ${title}`;
	return `Waiting in the terminal: ${prompt.kind === "editor" ? "an editor" : "a dialog"}`;
}
