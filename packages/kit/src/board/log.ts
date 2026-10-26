// One operation per entry, folded in branch order, so the log stays small and follows `/tree` and forks.
import { isObject } from "../decode.ts";
import { foldBoard, type Board, type BoardOp } from "./model.ts";

export const BOARD_OP = "pi-board:op";

/** An unknown or half-written operation is skipped. */
function isBoardOp(value: unknown): value is BoardOp {
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

/** Empty when the branch has no board operations. */
export function boardOf(branch: readonly unknown[]): Board {
	return foldBoard(opsOf(branch));
}
