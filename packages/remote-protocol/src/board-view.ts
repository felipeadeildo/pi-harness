// What a session's board holds, as it travels: the shape the kit draws and the wire carries. A copy,
// like `SessionTasks`, because the wire may not assume the kit is on the other side.
import { isObject } from "./by.ts";

/** A column of the board, as the writer named it. A reader draws the word it received. */
export type BoardColumn = "backlog" | "todo" | "doing" | "review" | "done" | "dropped";

/** Why a card waits, and for whom. The value names the thing, never the reader. */
export type BoardBlocker = { why: string } & (
	| { on: "operator" }
	| { on: "outside" }
	| { on: "agent"; handle: string }
);

export interface BoardCard {
	id: string;
	title: string;
	column: BoardColumn;
	pr?: number;
	now?: string;
	blocked?: BoardBlocker;
	reviewer?: string;
	result?: string;
	why?: string;
	at: number;
}

export interface BoardView {
	/** The cards a panel shows, in the order their writer cut and ordered them. */
	open: BoardCard[];
	backlog: number;
	done: BoardCard[];
}

/** Whether a value is a board view this version reads. A card without its four fields is not one. */
export function isBoardView(value: unknown): value is BoardView {
	return (
		isObject(value) &&
		Array.isArray(value.open) &&
		value.open.every(isBoardCard) &&
		typeof value.backlog === "number" &&
		Array.isArray(value.done) &&
		value.done.every(isBoardCard)
	);
}

function isBoardCard(value: unknown): value is BoardCard {
	return (
		isObject(value) &&
		typeof value.id === "string" &&
		value.id !== "" &&
		typeof value.title === "string" &&
		typeof value.column === "string" &&
		typeof value.at === "number" &&
		Number.isFinite(value.at)
	);
}
