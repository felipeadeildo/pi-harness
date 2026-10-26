// A copy of the kit's board view, since the wire may not assume the kit is on the other side.
import { isObject } from "./by.ts";

export type BoardColumn = "backlog" | "todo" | "doing" | "review" | "done" | "dropped";

/** Names the thing, never the reader. */
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
	open: BoardCard[];
	backlog: number;
	done: BoardCard[];
}

/** `operator` reads as "you" only for the operator, so the reader is a parameter. */
export function blockedOf(blocked: BoardBlocker, reader: "operator" | "agent"): string {
	if (blocked.on === "operator")
		return `${reader === "operator" ? "você" : "o operador"}: ${blocked.why}`;
	if (blocked.on === "outside") return `fora: ${blocked.why}`;
	const handle = blocked.handle.startsWith("@") ? blocked.handle : `@${blocked.handle}`;
	return `${handle}: ${blocked.why}`;
}

/** A card without its four fields is not one. */
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
