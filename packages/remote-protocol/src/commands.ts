// The commands a client sends to a session, with the shape each takes. A command is answered on the
// envelope's `id`, so a resent command is a repeat instead of a second effect.

import { isObject } from "./by.ts";
import type { AskResult, PermissionMode } from "./facts.ts";

export interface CommandMap {
	"prompt.send": { text: string; images?: string[]; deliverAs?: "steer" | "followUp" | "nextTurn" };
	/** Takes the queued messages back: all of them, or the ones named. Absent ids take everything. */
	"queue.clear": { ids?: string[] };
	"run.abort": Record<string, never>;
	"ask.answer": { ask: string; result: AskResult };
	"model.set": { provider: string; id: string };
	"thinking.set": { level: string };
	"mode.set": { mode: PermissionMode };
	"session.compact": { instructions?: string };
	"session.rename": { name: string };
	"session.stop": { force?: boolean };
	"session.fork": { entryId: string };
	"session.clone": Record<string, never>;
	"tree.get": Record<string, never>;
}

export type CommandType = keyof CommandMap;

export const COMMAND_TYPES: readonly CommandType[] = [
	"prompt.send",
	"queue.clear",
	"run.abort",
	"ask.answer",
	"model.set",
	"thinking.set",
	"mode.set",
	"session.compact",
	"session.rename",
	"session.stop",
	"session.fork",
	"session.clone",
	"tree.get",
];

/**
 * Whether a command carries the fields it needs. Only the fields whose absence would break the run
 * are checked: a command from a newer client still runs while the old fields are there.
 */
export function isCommand(type: string, data: unknown): boolean {
	if (!isObject(data)) return false;
	switch (type) {
		case "prompt.send":
			return typeof data.text === "string";
		case "ask.answer":
			return typeof data.ask === "string" && isObject(data.result);
		case "model.set":
			return typeof data.provider === "string" && typeof data.id === "string";
		case "thinking.set":
			return typeof data.level === "string";
		case "mode.set":
			return (
				data.mode === "manual" ||
				data.mode === "edits" ||
				data.mode === "judge" ||
				data.mode === "full"
			);
		case "session.rename":
			return typeof data.name === "string";
		case "session.fork":
			return typeof data.entryId === "string";
		case "session.compact":
			return data.instructions === undefined || typeof data.instructions === "string";
		case "session.stop":
			return data.force === undefined || typeof data.force === "boolean";
		case "queue.clear":
			return (
				data.ids === undefined ||
				(Array.isArray(data.ids) && data.ids.every((id) => typeof id === "string"))
			);
		case "run.abort":
		case "session.clone":
		case "tree.get":
			return true;
		default:
			return false;
	}
}
