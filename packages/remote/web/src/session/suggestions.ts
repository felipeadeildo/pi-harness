// What the field offers for the word under the cursor: `/` the session's commands, `@` the agents a
// mention reaches. A command the session does not offer is never offered.

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

export interface Suggestion {
	/** What goes in the field, with its `/` or `@`. */
	value: string;
	description?: string;
	group: "skill" | "prompt" | "pi" | "agent";
}

/** An agent a mention can reach, as the list shows it. */
export interface Mentionable {
	handle: string;
	name?: string;
	folder?: string;
}

interface Word {
	sign: "/" | "@";
	/** Where the word starts, at its sign. */
	start: number;
	query: string;
}

/** The `/` or `@` word that ends at the cursor, at the start of the text or after a space. */
export function wordAt(text: string, cursor: number): Word | undefined {
	const before = text.slice(0, cursor);
	const match = /(?:^|\s)([/@])([^\s/@]*(?::[^\s]*)?)$/.exec(before);
	if (match === null) return undefined;
	const sign = match[1] as "/" | "@";
	const query = match[2] ?? "";
	return { sign, start: before.length - query.length - 1, query };
}

const GROUP_MENTIONS: readonly Suggestion[] = [
	{ value: "@everyone", description: "Every agent in your rooms", group: "agent" },
	{ value: "@anyone", description: "The agent that fits it best", group: "agent" },
];

export function suggestedAt(
	text: string,
	cursor: number,
	commands: readonly SessionCommand[],
	agents: readonly Mentionable[],
): Suggestion[] {
	const word = wordAt(text, cursor);
	if (word === undefined) return [];
	const typed = word.query.toLowerCase();
	if (word.sign === "@") {
		const named = agents.map((agent) => ({
			value: `@${agent.handle}`,
			...(agent.name === undefined && agent.folder === undefined
				? {}
				: { description: [agent.name, agent.folder].filter(Boolean).join(", ") }),
			group: "agent" as const,
		}));
		return [...named, ...GROUP_MENTIONS].filter((one) =>
			one.value.slice(1).toLowerCase().startsWith(typed),
		);
	}
	// Only a skill expands inside a sentence; a template or a command runs from the start.
	const atStart = text.slice(0, word.start).trim() === "";
	return commands
		.filter((command) => atStart || command.source === "skill")
		.filter((command) => command.name.toLowerCase().startsWith(typed))
		.map((command) => ({
			value: `/${command.name}`,
			...(command.description === undefined ? {} : { description: command.description }),
			group: command.source,
		}));
}

/** The text with the word at the cursor replaced by `value` and a space, and where the cursor goes. */
export function insertAt(
	text: string,
	cursor: number,
	value: string,
): { text: string; cursor: number } {
	const word = wordAt(text, cursor);
	if (word === undefined) return { text, cursor };
	const after = text.slice(cursor).replace(/^\S*/, "");
	const spaced = after.startsWith(" ") ? after : ` ${after}`;
	const next = `${text.slice(0, word.start)}${value}${spaced}`;
	return { text: next, cursor: word.start + value.length + 1 };
}

/** A command picked from the list goes first, where a template or a command runs from. */
export function withCommand(text: string, name: string): { text: string; cursor: number } {
	const rest = text.trimStart();
	const next = rest === "" ? `/${name} ` : `/${name} ${rest}`;
	return { text: next, cursor: next.length };
}

/** The commands whose name or description holds the query, in the session's order. */
export function matchCommands(
	commands: readonly SessionCommand[],
	query: string,
): SessionCommand[] {
	const typed = query.trim().toLowerCase().replace(/^\//, "");
	if (typed === "") return [...commands];
	return commands.filter(
		(command) =>
			command.name.toLowerCase().includes(typed) ||
			(command.description?.toLowerCase().includes(typed) ?? false),
	);
}

/** The pieces of the text the field paints: commands the session offers and agents it knows. */
export function marked(
	text: string,
	commands: readonly SessionCommand[],
	agents: readonly Mentionable[],
): { text: string; mark: boolean }[] {
	const names = new Set(commands.map((command) => `/${command.name}`));
	const handles = new Set([
		...agents.map((agent) => `@${agent.handle}`),
		...GROUP_MENTIONS.map((one) => one.value),
	]);
	const pieces: { text: string; mark: boolean }[] = [];
	let last = 0;
	for (const match of text.matchAll(/(^|\s)([/@][^\s]+)/g)) {
		const word = match[2] ?? "";
		const start = (match.index ?? 0) + (match[1]?.length ?? 0);
		if (!names.has(word) && !handles.has(word)) continue;
		if (start > last) pieces.push({ text: text.slice(last, start), mark: false });
		pieces.push({ text: word, mark: true });
		last = start + word.length;
	}
	if (last < text.length) pieces.push({ text: text.slice(last), mark: false });
	return pieces;
}
