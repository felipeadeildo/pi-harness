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
	timestamp?: string;
	message?: { role?: string; content?: unknown; toolCallId?: unknown; isError?: unknown };
}

interface Part {
	type?: string;
	id?: unknown;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
}

export interface Line {
	text: string;
	at?: number;
}

export interface Excerpt {
	text: string;
	lines: Line[];
	from?: string;
	to?: string;
}

/** After `after`, or after the last goal update when `after` is not on the branch. */
export function workSince(branch: readonly unknown[], after?: string): Excerpt {
	const entries = branch as readonly Entry[];
	const seen = indexOf(entries, after);
	const start = (seen === -1 ? lastUpdateIndex(entries) : seen) + 1;
	return excerpt(entries.slice(start), false);
}

/** With your messages, since you are the one who says a command you ran is done. */
export function sessionSince(branch: readonly unknown[], after?: string): Excerpt {
	const entries = branch as readonly Entry[];
	return excerpt(entries.slice(indexOf(entries, after) + 1), true);
}

function indexOf(entries: readonly Entry[], id: string | undefined): number {
	return id === undefined ? -1 : entries.findIndex((entry) => entry.id === id);
}

export const CALL = "call: ";
/** In place of the output, which the model never reads. */
export const FAILED = "(failed or refused, so it did not happen)";

function excerpt(read: readonly Entry[], conversation: boolean): Excerpt {
	const lines: Line[] = [];
	const failed = failedCalls(read);

	for (const entry of read) {
		const parsed = Date.parse(entry.timestamp ?? "");
		const push = (text: string) =>
			lines.push(Number.isNaN(parsed) ? { text } : { text, at: parsed });
		const said = conversation ? operatorText(entry.message) : undefined;
		if (entry.type === "message" && said !== undefined)
			push(`operator: ${clip(oneLine(said), MAX_SAID)}`);
		for (const part of assistantParts(entry)) {
			if (part.type === "text" && typeof part.text === "string" && part.text.trim() !== "")
				push(`said: ${clip(oneLine(part.text), MAX_SAID)}`);
			if (!conversation && part.type === "toolCall" && typeof part.name === "string") {
				const outcome = failed.has(part.id) ? ` ${FAILED}` : "";
				push(`${CALL}${callOf(part.name, part.arguments)}${outcome}`);
			}
		}
	}

	const kept = newest(lines, conversation ? MAX_CONVERSATION : MAX_EXCERPT);
	const text = kept.map((line) => line.text).join("\n");
	return { text, lines: kept, from: read[0]?.id, to: read.at(-1)?.id };
}

export function untimed(text: string): Line[] {
	return text.split("\n").map((line) => ({ text: line }));
}

/** Only the error flag is read, never the output. */
function failedCalls(read: readonly Entry[]): Set<unknown> {
	const ids = read.flatMap((entry) =>
		entry.message?.role === "toolResult" && entry.message.isError === true
			? [entry.message.toolCallId]
			: [],
	);
	return new Set(ids);
}

function callOf(name: string, args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	const target = [fields.path, fields.command, fields.query, fields.url].find(
		(value): value is string => typeof value === "string" && value.trim() !== "",
	);
	const shown = target === undefined ? JSON.stringify(fields) : (target.split("\n")[0] ?? "");
	return `${name} ${clip(shown, MAX_CALL)}`;
}

function newest(lines: readonly Line[], max: number): Line[] {
	const kept: Line[] = [];
	let size = 0;
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index] ?? { text: "" };
		if (size + line.text.length > max && kept.length > 0) {
			kept.unshift({ text: `(${index + 1} earlier lines left out)` });
			break;
		}
		kept.unshift(line);
		size += line.text.length + 1;
	}
	return kept;
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

export interface SkillNote {
	name: string;
	description?: string;
}

/** `/skill:name` reads as a bare command to the goal's model, so each one becomes an ask. */
export function withSkills(text: string, skills: readonly SkillNote[]): string {
	return text.replace(/\/skill:([\w.-]+)/g, (reference, name: string) => {
		const description = skills.find((skill) => skill.name === name)?.description;
		if (description === undefined) return reference;
		return `run the skill "${name}" (${clip(oneLine(description), 200)})`;
	});
}

export function messageEntry(branch: readonly unknown[], text: string): string | undefined {
	const entries = branch as readonly Entry[];
	return entries.findLast(
		(entry) => entry.type === "message" && operatorText(entry.message) === text,
	)?.id;
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
