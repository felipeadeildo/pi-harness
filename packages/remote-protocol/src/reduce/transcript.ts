// The transcript of one branch: pi's entries are the conversation, and the live stream only carries
// the message being written. So a reader puts the branch back together by `parentId` and draws it in
// the order pi wrote it, which is what makes a reconnect show nothing twice.

import { isObject } from "../by.ts";

/** An entry, read by the fields the tree needs. The rest travels untouched. */
export interface Entry {
	id: string;
	parentId: string | null;
	type: string;
	timestamp?: string;
}

/** A message as pi stores it, with only the fields a screen reads. */
export interface ChatMessage {
	role: string;
	content: unknown;
	timestamp?: number;
	stopReason?: string;
	errorMessage?: string;
}

export type TranscriptItem =
	| { kind: "message"; entry: string; at?: string; message: ChatMessage }
	| {
			kind: "custom";
			entry: string;
			at?: string;
			customType: string;
			data: unknown;
			/** A message an extension put in the session says whether pi shows it in the chat. */
			display?: boolean;
	  }
	| { kind: "compaction"; entry: string; at?: string; summary: string; firstKept?: string }
	| { kind: "branch"; entry: string; at?: string; from: string; summary: string }
	| { kind: "model"; entry: string; at?: string; provider: string; model: string }
	| { kind: "thinking"; entry: string; at?: string; level: string }
	| { kind: "session"; entry: string; at?: string; name?: string }
	| { kind: "label"; entry: string; at?: string; target: string; label?: string }
	| { kind: "usage"; entry: string; at?: string }
	| { kind: "edit"; entry: string; at?: string; target: string }
	/** An entry a newer pi writes, kept so the transcript shows it happened without inventing a shape. */
	| { kind: "other"; entry: string; at?: string; type: string };

/** What a reader holds of one session: the branch, and where it ends. */
export interface Transcript {
	items: TranscriptItem[];
	/** The entry the branch starts from, which is what a moved leaf changed. */
	leaf?: string;
}

function field<T>(entry: Entry, name: string): T | undefined {
	// Read by name through `Reflect`: the entry is a shape the protocol keeps rather than one it owns,
	// so no cast to a record it never promised. The guard keeps the old behaviour on a value that is
	// not an object, where `Reflect.get` would throw and the cast read `undefined`.
	const value: unknown = isObject(entry) ? Reflect.get(entry, name) : undefined;
	return value === undefined ? undefined : (value as T);
}

/**
 * The entries from the root to `leaf`, in order. Without a leaf it takes the last entry, which is
 * where pi left the session. An entry whose parent is missing ends the walk, so a file that lost
 * entries in a migration still yields the part it kept.
 */
export function branchOf(entries: readonly Entry[], leaf?: string): Entry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const start = leaf === undefined ? entries.at(-1) : byId.get(leaf);
	if (start === undefined) return [];
	const walked: Entry[] = [];
	const seen = new Set<string>();
	for (let entry: Entry | undefined = start; entry !== undefined && !seen.has(entry.id);) {
		seen.add(entry.id);
		walked.push(entry);
		entry = entry.parentId === null ? undefined : byId.get(entry.parentId);
	}
	return walked.reverse();
}

/** One entry as the screen draws it. */
export function itemOf(entry: Entry): TranscriptItem {
	switch (entry.type) {
		case "message":
			return {
				kind: "message",
				entry: entry.id,
				at: entry.timestamp,
				message: field<ChatMessage>(entry, "message") ?? { role: "unknown", content: [] },
			};
		case "custom":
			return {
				kind: "custom",
				entry: entry.id,
				at: entry.timestamp,
				customType: field<string>(entry, "customType") ?? "",
				data: field<unknown>(entry, "data"),
			};
		case "custom_message":
			return {
				kind: "custom",
				entry: entry.id,
				at: entry.timestamp,
				customType: field<string>(entry, "customType") ?? "",
				data: field<unknown>(entry, "content"),
				...(field<boolean>(entry, "display") === true ? { display: true } : {}),
			};
		case "compaction":
			return {
				kind: "compaction",
				entry: entry.id,
				at: entry.timestamp,
				summary: field<string>(entry, "summary") ?? "",
				firstKept: field<string>(entry, "firstKeptEntryId"),
			};
		case "branch_summary":
			return {
				kind: "branch",
				entry: entry.id,
				at: entry.timestamp,
				from: field<string>(entry, "fromId") ?? "",
				summary: field<string>(entry, "summary") ?? "",
			};
		case "model_change":
			return {
				kind: "model",
				entry: entry.id,
				at: entry.timestamp,
				provider: field<string>(entry, "provider") ?? "",
				model: field<string>(entry, "modelId") ?? "",
			};
		case "thinking_level_change":
			return {
				kind: "thinking",
				entry: entry.id,
				at: entry.timestamp,
				level: field<string>(entry, "thinkingLevel") ?? "",
			};
		case "session_info":
			return {
				kind: "session",
				entry: entry.id,
				at: entry.timestamp,
				name: field<string>(entry, "name"),
			};
		case "label":
			return {
				kind: "label",
				entry: entry.id,
				at: entry.timestamp,
				target: field<string>(entry, "targetId") ?? "",
				label: field<string>(entry, "label"),
			};
		case "usage":
			return { kind: "usage", entry: entry.id, at: entry.timestamp };
		case "context_edit":
			return {
				kind: "edit",
				entry: entry.id,
				at: entry.timestamp,
				target: field<string>(entry, "targetId") ?? "",
			};
		default:
			return { kind: "other", entry: entry.id, at: entry.timestamp, type: entry.type };
	}
}

/** The branch, drawn. */
export function transcriptOf(entries: readonly Entry[], leaf?: string): Transcript {
	const branch = branchOf(entries, leaf);
	const last = branch.at(-1);
	return {
		items: branch.map(itemOf),
		...(last === undefined ? {} : { leaf: last.id }),
	};
}
