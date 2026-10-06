// What the agent did since the last update, as the updater reads it: what it said along the way and
// what each call touched, in order. The words carry the meaning; a call alone, like a script piped
// into bash, rarely says what it was for. Tool results stay out, because a file or a page could
// carry instructions.
import { GOAL_ENTRY } from "@adeildo/pi-kit";

/** The digest keeps its newest part within this many characters. */
const MAX_DIGEST = 6000;
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

export interface Work {
	/** The digest the model reads. Empty when the agent did nothing since. */
	text: string;
	/** The first and last entries read. */
	from?: string;
	to?: string;
}

/** From the entry after `after`, or after the last update when it is not on the branch. */
export function workSince(branch: readonly unknown[], after?: string): Work {
	const entries = branch as readonly Entry[];
	const seen = indexOf(entries, after);
	const start = (seen === -1 ? lastUpdateIndex(entries) : seen) + 1;
	return digest(entries.slice(start), false);
}

/**
 * For the tidy pass: your messages and the agent's work since `after`, or the whole branch the first
 * time, newest kept. Your words are what tell it that something waiting was done, like a command
 * you ran yourself.
 */
export function sessionSince(branch: readonly unknown[], after?: string): Work {
	const entries = branch as readonly Entry[];
	return digest(entries.slice(indexOf(entries, after) + 1), true);
}

/** Where `id` sits on the branch, or -1 when it is not given or not there. */
function indexOf(entries: readonly Entry[], id: string | undefined): number {
	return id === undefined ? -1 : entries.findIndex((entry) => entry.id === id);
}

function digest(read: readonly Entry[], withOperator: boolean): Work {
	const lines: string[] = [];

	for (const entry of read) {
		if (withOperator && entry.type === "message" && entry.message?.role === "user") {
			const text = textOf(entry.message.content);
			if (text !== "") lines.push(`operator: ${clip(oneLine(text), MAX_SAID)}`);
		}
		for (const part of assistantParts(entry)) {
			if (part.type === "text" && typeof part.text === "string" && part.text.trim() !== "")
				lines.push(`said: ${clip(oneLine(part.text), MAX_SAID)}`);
			if (part.type === "toolCall" && typeof part.name === "string")
				lines.push(`call: ${callOf(part.name, part.arguments)}`);
		}
	}

	return { text: newest(lines, MAX_DIGEST), from: read[0]?.id, to: read.at(-1)?.id };
}

/** What a call touched: the path of a file tool, the first line of a command, else its arguments. */
function callOf(name: string, args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	const target = [fields.path, fields.command, fields.query, fields.url].find(
		(value): value is string => typeof value === "string" && value.trim() !== "",
	);
	const shown = target === undefined ? JSON.stringify(fields) : (target.split("\n")[0] ?? "");
	return `${name} ${clip(shown, MAX_CALL)}`;
}

/** The last lines that fit in `max` characters, with how many earlier ones were left out. */
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

/** Your last message on the branch, and the entry it is. */
export function lastMessage(
	branch: readonly unknown[],
): { text: string; entry?: string } | undefined {
	const entries = branch as readonly Entry[];
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const text = textOf(entry.message.content);
		if (text !== "") return { text: clip(text, MAX_WORDS), entry: entry.id };
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
