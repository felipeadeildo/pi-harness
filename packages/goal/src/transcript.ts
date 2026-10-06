// What the goal's model reads of the branch. Tool results stay out: they could carry instructions.
import { GOAL_ENTRY } from "@adeildo/pi-kit";

const MAX_EXCERPT = 6000;
/** The tidy pass reads only words, so more of the session fits. */
const MAX_CONVERSATION = 12000;
const MAX_SAID = 400;
const MAX_CALL = 100;
const MAX_WORDS = 1500;

interface Entry {
	id?: string;
	type?: string;
	customType?: string;
	message?: { role?: string; content?: unknown };
}

interface Part {
	type?: string;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
}

export interface Excerpt {
	text: string;
	from?: string;
	to?: string;
}

/** The agent's work after `after`, or after the last goal update when `after` is not on the branch. */
export function workSince(branch: readonly unknown[], after?: string): Excerpt {
	const entries = branch as readonly Entry[];
	const seen = indexOf(entries, after);
	const start = (seen === -1 ? lastUpdateIndex(entries) : seen) + 1;
	return excerpt(entries.slice(start), false);
}

/** Your messages and the agent's work after `after`: you are the one who says a command you ran is done. */
export function sessionSince(branch: readonly unknown[], after?: string): Excerpt {
	const entries = branch as readonly Entry[];
	return excerpt(entries.slice(indexOf(entries, after) + 1), true);
}

function indexOf(entries: readonly Entry[], id: string | undefined): number {
	return id === undefined ? -1 : entries.findIndex((entry) => entry.id === id);
}

function excerpt(read: readonly Entry[], conversation: boolean): Excerpt {
	const lines: string[] = [];

	for (const entry of read) {
		const said = conversation ? operatorText(entry.message) : undefined;
		if (entry.type === "message" && said !== undefined)
			lines.push(`operator: ${clip(oneLine(said), MAX_SAID)}`);
		for (const part of assistantParts(entry)) {
			if (part.type === "text" && typeof part.text === "string" && part.text.trim() !== "")
				lines.push(`said: ${clip(oneLine(part.text), MAX_SAID)}`);
			if (!conversation && part.type === "toolCall" && typeof part.name === "string")
				lines.push(`call: ${callOf(part.name, part.arguments)}`);
		}
	}

	const budget = conversation ? MAX_CONVERSATION : MAX_EXCERPT;
	return { text: newest(lines, budget), from: read[0]?.id, to: read.at(-1)?.id };
}

/** The path of a file tool, the first line of a command, else the arguments. */
function callOf(name: string, args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	const target = [fields.path, fields.command, fields.query, fields.url].find(
		(value): value is string => typeof value === "string" && value.trim() !== "",
	);
	const shown = target === undefined ? JSON.stringify(fields) : (target.split("\n")[0] ?? "");
	return `${name} ${clip(shown, MAX_CALL)}`;
}

/** The last lines within `max` characters, and how many earlier ones were left out. */
function newest(lines: readonly string[], max: number): string {
	const kept: string[] = [];
	let size = 0;
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index] ?? "";
		if (size + line.length > max && kept.length > 0) {
			kept.unshift(`(${index + 1} earlier lines left out)`);
			break;
		}
		kept.unshift(line);
		size += line.length + 1;
	}
	return kept.join("\n");
}

function oneLine(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

/** What you wrote in a message, without the skill blocks pi expands into it. */
export function operatorText(message: unknown): string | undefined {
	const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
	if (role !== "user") return undefined;
	const text = textOf(content)
		.replace(/<skill name="[^"]*"[^>]*>[\s\S]*?<\/skill>/g, "")
		.trim();
	return text === "" ? undefined : text;
}

export function lastMessage(
	branch: readonly unknown[],
): { text: string; entry?: string } | undefined {
	const entries = branch as readonly Entry[];
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		const text = entry?.type === "message" ? operatorText(entry.message) : undefined;
		if (text !== undefined) return { text: clip(text, MAX_WORDS), entry: entry?.id };
	}
	return undefined;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return (content as Part[])
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("\n")
		.trim();
}

function lastUpdateIndex(entries: readonly Entry[]): number {
	return entries.findLastIndex(
		(entry) => entry.type === "custom" && entry.customType === GOAL_ENTRY,
	);
}

function assistantParts(entry: Entry): Part[] {
	if (entry.type !== "message" || entry.message?.role !== "assistant") return [];
	const content = entry.message.content;
	return Array.isArray(content) ? (content as Part[]) : [];
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}
