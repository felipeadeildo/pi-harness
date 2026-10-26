// What the chrome lists, apart from the views that draw it: a phone draws with views, and a test cannot.
import {
	type BoardCard,
	type BoardView,
	type SessionState,
	type SessionTasks,
} from "@adeildo/pi-remote-protocol";

import { plain } from "../../render/index.ts";

/** The tasks a session is on, never what is done or dropped. */
const OPEN: ReadonlySet<string> = new Set(["doing", "waiting", "queued"]);

/** The tasks a session is on, and the line each draws. */
export function openTasksOf(tasks: SessionTasks | undefined): { id: string; line: string }[] {
	return (tasks?.tasks ?? [])
		.filter((task) => OPEN.has(task.status))
		.map((task) => ({ id: task.id, line: `${task.status} · ${plain(task.text)}` }));
}

/**
 * The cards a panel draws, in the order their writer cut and ordered them. Nothing is sorted here: the
 * board arrives that way, and a screen that reordered would be a second opinion about the same list.
 */
export function boardCards(board: BoardView | undefined): { id: string; line: string }[] {
	return (board?.open ?? []).map((card) => ({
		id: card.id,
		line: [card.column, plain(card.title), factOf(card)].filter((one) => one !== "").join(" · "),
	}));
}

/**
 * Why a card waits, as the person holding the phone reads it. The kit has the same sentence for the
 * terminal; the app does not import the kit, so the words live here, and the shape they translate is
 * the protocol's one.
 */
function blockedOf(blocked: BoardCard["blocked"]): string {
	if (blocked === undefined) return "";
	if (blocked.on === "operator") return `you: ${plain(blocked.why)}`;
	if (blocked.on === "outside") return `outside: ${plain(blocked.why)}`;
	return `@${blocked.handle}: ${plain(blocked.why)}`;
}

/** The one fact that goes with the card's column: what it waits on, or who reviews it. */
function factOf(card: BoardCard): string {
	if (card.blocked !== undefined) return blockedOf(card.blocked);
	if (card.reviewer !== undefined) return `review: ${card.reviewer}`;
	return "";
}

/**
 * The line for a dialog only the terminal can answer, or nothing when the terminal waits on none. The
 * title is text from another extension, so it goes through `plain`; a dialog with no title is named by
 * what it is, because "waiting in the terminal" alone leaves the person asking for what.
 */
export function terminalWait(prompt: SessionState["prompt"]): string | undefined {
	if (prompt === undefined) return undefined;
	const title = prompt.title === undefined ? "" : plain(prompt.title).trim();
	const what = title !== "" ? title : prompt.kind === "editor" ? "an editor" : "a dialog";
	return `Waiting in the terminal: ${what}`;
}
