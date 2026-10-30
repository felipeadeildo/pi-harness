// `@name` sends to one agent, `@everyone` to all of them, `@anyone` to the best bidder. Pi also uses
// `@` for files, so only an open session's name counts. `#room` says which room, and a `#` word no
// room is called stays text, like an issue number.
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	fuzzyFilter,
} from "@earendil-works/pi-tui";

import { mentionedNames, mentionsIn, type Named, type Names } from "./names.ts";

export const EVERYONE_MENTION = "everyone";
export const ANYONE_MENTION = "anyone";

export type Mentionable = Named & { where?: string };

export function isGroupMention(name: string): boolean {
	return name === EVERYONE_MENTION || name === ANYONE_MENTION;
}

export function audienceLabel(to: "all" | "any"): string {
	return to === "all" ? EVERYONE_MENTION : ANYONE_MENTION;
}

const GROUPS: Record<string, string> = {
	[EVERYONE_MENTION]: "every agent here gets it",
	[ANYONE_MENTION]: "the agent that fits it best takes it",
};

const TYPING_PATTERN = /(?:^|[\s([{<`])(@[a-z0-9-]*)$/i;
const ROOM_TAG = /(?<![\w#&/])#([\p{L}\p{N}][\p{L}\p{N}+_.-]*)/gu;
const TYPING_TAG = /(?:^|[\s([{<`])(#[\p{L}\p{N}+_.-]*)$/u;

export interface RoomTag {
	tag: string;
	description: string;
}

/** What follows the `#`: the name in lower case, spaces as dashes. */
export function roomTag(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function roomTagsIn(text: string): string[] {
	return [...text.matchAll(ROOM_TAG)].map((match) =>
		(match[1] ?? "").replace(/\.+$/, "").toLowerCase(),
	);
}

export function typingMention(text: string): string | undefined {
	return TYPING_PATTERN.exec(text)?.[1]?.slice(1).toLowerCase();
}

export function groupIn(mentioned: readonly string[]): "all" | "any" | undefined {
	if (mentioned.includes(EVERYONE_MENTION)) return "all";
	if (mentioned.includes(ANYONE_MENTION)) return "any";
	return undefined;
}

/** Undefined when the message mentions no other agent, so it goes to yours. */
export function recipientsOf(
	names: Names,
	me: string | undefined,
	text: string,
): Named[] | "all" | "any" | undefined {
	const group = groupIn(mentionedNames(text));
	if (group !== undefined) return group;
	const named = mentionsIn(names, text).filter((one) => one.session !== me);
	return named.length === 0 ? undefined : named;
}

/** Agents, `@everyone` and `@anyone` above pi's files in the `@` list, and the rooms after `#`. */
export function completeMentions(
	current: AutocompleteProvider,
	others: () => readonly Mentionable[],
	rooms: () => readonly RoomTag[] = () => [],
): AutocompleteProvider {
	function isMention(item: AutocompleteItem): boolean {
		if (rooms().some((room) => item.value === `#${room.tag}`)) return true;
		if (isGroupMention(item.value.slice(1))) return true;
		return others().some((named) => item.value === `@${named.handle}`);
	}

	return {
		triggerCharacters: [...(current.triggerCharacters ?? []), "#"],

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
			const tag = before.match(TYPING_TAG)?.[1];
			if (tag !== undefined) {
				const items = roomItems(rooms(), tag.slice(1));
				if (items.length > 0) return { items, prefix: tag };
			}
			const typed = before.match(TYPING_PATTERN)?.[1];
			const files = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			const agents = typed === undefined ? [] : mentionItems(others(), typed.slice(1));
			if (typed === undefined || agents.length === 0) return files;
			// Pi's files go below, unless pi read the word before the cursor differently.
			const below = files?.prefix === typed ? files.items : [];
			return { items: [...agents, ...below], prefix: typed };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!isMention(item) || !(prefix.startsWith("@") || prefix.startsWith("#")))
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			const line = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			const rest = line.slice(cursorCol);
			const after = rest.startsWith(" ") ? rest : ` ${rest}`;
			return {
				lines: lines.with(cursorLine, line.slice(0, start) + item.value + after),
				cursorLine,
				cursorCol: start + item.value.length + 1,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/** Only with two rooms or more: with one, there is nothing to choose. */
function roomItems(rooms: readonly RoomTag[], query: string): AutocompleteItem[] {
	if (rooms.length < 2) return [];
	return fuzzyFilter([...rooms], query, (room) => room.tag).map((room) => ({
		value: `#${room.tag}`,
		label: `#${room.tag}`,
		description: room.description,
	}));
}

function mentionItems(others: readonly Mentionable[], query: string): AutocompleteItem[] {
	if (others.length === 0) return [];
	const agents = fuzzyFilter([...others], query, (named) => named.handle).map((named) => ({
		value: `@${named.handle}`,
		label: `@${named.handle}`,
		description: named.where ?? "agent in this folder",
	}));
	const groups = fuzzyFilter([EVERYONE_MENTION, ANYONE_MENTION], query, (name) => name).map(
		(name) => ({
			value: `@${name}`,
			label: `@${name}`,
			description: GROUPS[name] ?? "",
		}),
	);
	return [...agents, ...groups];
}
