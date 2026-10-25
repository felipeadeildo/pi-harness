// The board's log entries: one operation each, folded in the order the branch wrote them. Storing the
// operation instead of the whole board keeps a session's log small and follows a `/tree` or a fork.
import { isObject } from "../decode.ts";
import { foldBoard, type Board, type BoardOp } from "./model.ts";

export const BOARD_OP = "pi-board:op";

/** One board operation as the session log carries it. */
export interface BoardEntry {
	type: "custom";
	customType: typeof BOARD_OP;
	data: { version: 1; op: BoardOp };
}

/** Whether a value is an operation this version knows. An unknown or half-written one is skipped. */
export function isBoardOp(value: unknown): value is BoardOp {
	if (!isObject(value) || typeof value.op !== "string" || typeof value.at !== "number")
		return false;
	switch (value.op) {
		case "add":
			return typeof value.title === "string";
		case "move":
			return typeof value.id === "string" && typeof value.column === "string";
		case "edit":
			return typeof value.id === "string";
		case "drop":
			return typeof value.id === "string" && typeof value.why === "string";
		case "decide":
			return typeof value.text === "string";
		default:
			return false;
	}
}

/** The board operations of a branch, in the order they were written. */
export function opsOf(branch: readonly unknown[]): BoardOp[] {
	const ops: BoardOp[] = [];
	for (const entry of branch) {
		if (!isObject(entry) || entry.type !== "custom" || entry.customType !== BOARD_OP) continue;
		const data = entry.data;
		if (!isObject(data) || data.version !== 1 || !isBoardOp(data.op)) continue;
		ops.push(data.op);
	}
	return ops;
}

/** The board a branch carries. A session with no board operations starts with an empty board. */
export function boardOf(branch: readonly unknown[]): Board {
	return foldBoard(opsOf(branch));
}
