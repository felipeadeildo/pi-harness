// The model's operations, read defensively: one that strays loses only itself.
import type { GoalOp } from "@adeildo/pi-kit";

const MAX_TEXT = 120;

export const OPS = [
	"goal",
	"language",
	"start",
	"resume",
	"pause",
	"done",
	"later",
	"drop",
	"rename",
] as const;

export function opsOf(raw: unknown): GoalOp[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry): GoalOp[] => {
		const op = entryOf(entry);
		return op === undefined ? [] : [op];
	});
}

function entryOf(entry: unknown): GoalOp | undefined {
	if (typeof entry !== "object" || entry === null) return undefined;
	const raw = entry as Record<string, unknown>;
	const text = clean(raw.text);
	const id = typeof raw.id === "string" ? raw.id : undefined;
	const activeText = clean(raw.active);
	const noteText = clean(raw.note);
	const active = activeText === undefined ? {} : { active: activeText };
	const note = noteText === undefined ? {} : { note: noteText };
	switch (raw.op) {
		case "goal":
		case "language":
			return text ? { op: raw.op, text } : undefined;
		case "start":
			return text ? { op: "start", text, ...active } : undefined;
		case "later":
			return text ? { op: "later", text, ...active, ...note } : undefined;
		case "rename":
			return id && text ? { op: "rename", id, text, ...active } : undefined;
		case "resume":
			return id ? { op: "resume", id } : undefined;
		case "pause":
			return { op: "pause", ...note };
		case "done":
			return { op: "done", ...(id ? { id } : {}), ...note };
		case "drop":
			return id ? { op: "drop", id, ...note } : undefined;
		default:
			return undefined;
	}
}

function clean(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== ""
		? value.trim().slice(0, MAX_TEXT)
		: undefined;
}
