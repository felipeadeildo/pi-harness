// A session's history before its snapshot, read from the session file. The snapshot carries the
// tail of the branch; a client scrolling up asks for the page before the oldest entry it holds, and
// a client back from a while away asks for what was appended after the newest.
//
// Each page reads the file again and keeps nothing. A daemon that held every file it was asked about
// would grow with every session anyone scrolled, and a page is asked for when a person scrolls, so
// the read is rare and its cost is the file's size once.
import { readFileSync } from "node:fs";

/** A page is at most this many entries, and a client asks for fewer when it needs fewer. */
export const PAGE = 200;

/** An entry of a session file: everything pi wrote, with the two fields a page walks. */
export interface FileEntry {
	id: string;
	parentId?: string | null;
	[field: string]: unknown;
}

export interface PageRequest {
	/** The entries of the branch before this one, walking each entry's `parentId`. */
	before?: string;
	/** The entries appended after this one, in the order pi wrote them. */
	since?: string;
	limit?: number;
}

export type Page =
	| { entries: FileEntry[]; more: boolean }
	/** The cursor is not in the file, so the client drops what it holds of the session. */
	| { unknown: string }
	/** The file is not this session's: its header names another, or it cannot be read as one. */
	| { foreign: true };

/**
 * A page of the session file at `path`. Without a cursor, the tail of the branch at the last entry.
 * The path comes from the session's bridge, so the file must be that session's: its header names it.
 */
export function pageOf(path: string, session: string, request: PageRequest = {}): Page {
	const entries = entriesIn(path, session);
	if (entries === undefined) return { foreign: true };
	const limit = Math.max(1, Math.min(request.limit ?? PAGE, PAGE));
	if (request.since !== undefined) {
		const at = entries.findIndex((entry) => entry.id === request.since);
		if (at === -1) return { unknown: request.since };
		const after = entries.slice(at + 1);
		return { entries: after.slice(0, limit), more: after.length > limit };
	}
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const parentOf = (entry: FileEntry) =>
		typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined;
	const from = request.before === undefined ? entries.at(-1) : byId.get(request.before);
	if (from === undefined)
		return request.before === undefined
			? { entries: [], more: false }
			: { unknown: request.before };
	// `before` names an entry the client holds, so its page starts at the parent.
	let next = request.before === undefined ? from : parentOf(from);
	const page: FileEntry[] = [];
	while (next !== undefined && page.length < limit) {
		page.push(next);
		next = parentOf(next);
	}
	return { entries: page.toReversed(), more: next !== undefined };
}

/**
 * The file's entries in the order pi wrote them, without the header, which names the session. A line
 * that does not parse is skipped, so a write in progress at the end never fails a page. Pi names the
 * file when the session opens and writes it at the first message, so a file not there yet holds no
 * entries. Undefined for a file whose header names another session, or that cannot be read.
 */
function entriesIn(path: string, session: string): FileEntry[] | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined;
	}
	const entries: FileEntry[] = [];
	let header: FileEntry | undefined;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isEntry(value)) continue;
		if (header === undefined) {
			header = value;
			if (value.type !== "session" || value.id !== session) return undefined;
			continue;
		}
		entries.push(value);
	}
	return header === undefined && text.trim() !== "" ? undefined : entries;
}

function isEntry(value: unknown): value is FileEntry {
	return typeof value === "object" && value !== null && typeof (value as FileEntry).id === "string";
}
