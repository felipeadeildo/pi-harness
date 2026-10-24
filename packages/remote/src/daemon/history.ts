// A session's history before its snapshot, read from the session file. The snapshot carries the
// tail of the branch; a client scrolling up asks for the page before the oldest entry it holds, and
// a client back from a while away asks for what was appended after the newest.
//
// The daemon keeps an index of each file a client paged: where each entry's line is and its parent,
// never the entries. The first page of a file builds it, a later one reads only what the file gained,
// and a page then reads its own lines. All of it is asynchronous and yields while it parses, so a
// long session never holds up the bridges and the other clients.
import { type FileHandle, open } from "node:fs/promises";

/** A page is at most this many entries, and a client asks for fewer when it needs fewer. */
export const PAGE = 200;

/** The files indexed at once. Past it, the one paged longest ago is dropped and built again if asked. */
export const FILES = 16;

/** Lines parsed between two yields to the event loop while an index is built. */
const LINES_PER_TURN = 2_000;

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

interface Line {
	start: number;
	length: number;
	parent: string | undefined;
}

interface Index {
	session: string;
	ino: number;
	/** Bytes indexed, always at the end of a line. */
	size: number;
	mtimeMs: number;
	byId: Map<string, Line>;
	/** The ids in the order pi wrote them. */
	order: string[];
	/** Whether the header named the session. Undefined until the header line is read. */
	header?: boolean;
}

export class History {
	readonly #files = new Map<string, Index>();

	/**
	 * A page of the session file at `path`. Without a cursor, the tail of the branch at the last
	 * entry. The path comes from the session's bridge, so the file must be that session's: its header
	 * names it. Pi names the file when the session opens and writes it at the first message, so a file
	 * not there yet gives an empty page.
	 */
	async page(path: string, session: string, request: PageRequest = {}): Promise<Page> {
		let file: FileHandle;
		try {
			file = await open(path, "r");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], more: false };
			return { foreign: true };
		}
		try {
			const index = await this.#indexed(path, session, file);
			if (index.header === false) return { foreign: true };
			return await pageIn(file, index, request);
		} finally {
			await file.close();
		}
	}

	/** How many files are indexed now. */
	indexed(): number {
		return this.#files.size;
	}

	/** The index of a file, brought up to what the file holds now. */
	async #indexed(path: string, session: string, file: FileHandle): Promise<Index> {
		const { ino, size, mtimeMs } = await file.stat();
		let index = this.#files.get(path);
		// Pi rewrites the whole file when it migrates it: a new inode, a shorter file, or a last line
		// that no longer holds the entry it held starts over.
		if (
			index === undefined ||
			index.session !== session ||
			index.ino !== ino ||
			size < index.size ||
			(mtimeMs !== index.mtimeMs && !(await stillHolds(file, index)))
		)
			index = { session, ino, size: 0, mtimeMs: 0, byId: new Map(), order: [] };
		// Most recent last, so the first key is the file paged longest ago.
		this.#files.delete(path);
		this.#files.set(path, index);
		if (this.#files.size > FILES) this.#files.delete(this.#files.keys().next().value ?? path);
		if (size === index.size && mtimeMs === index.mtimeMs) return index;
		await extend(file, index, size);
		index.mtimeMs = mtimeMs;
		return index;
	}
}

/** Whether the last entry indexed is still where the index says, which a rewrite in place breaks. */
async function stillHolds(file: FileHandle, index: Index): Promise<boolean> {
	const last = index.order.at(-1);
	const line = last === undefined ? undefined : index.byId.get(last);
	if (last === undefined || line === undefined) return true;
	const buffer = Buffer.alloc(line.length);
	await file.read(buffer, 0, line.length, line.start);
	try {
		return (JSON.parse(buffer.toString("utf8")) as { id?: unknown }).id === last;
	} catch {
		return false;
	}
}

/** Reads the lines the file gained since the index was last brought up to date. */
async function extend(file: FileHandle, index: Index, size: number): Promise<void> {
	if (size <= index.size) return;
	const buffer = Buffer.alloc(size - index.size);
	await file.read(buffer, 0, buffer.length, index.size);
	const last = buffer.lastIndexOf(0x0a);
	// A line still being written waits for the next page.
	if (last === -1) return;
	let from = 0;
	let parsed = 0;
	while (from <= last) {
		const end = buffer.indexOf(0x0a, from);
		const text = buffer.subarray(from, end).toString("utf8");
		addLine(index, text, index.size + from, end - from);
		from = end + 1;
		if (++parsed % LINES_PER_TURN === 0) await new Promise((resolve) => setImmediate(resolve));
	}
	index.size += last + 1;
}

function addLine(index: Index, text: string, start: number, length: number): void {
	if (text.trim() === "") return;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return;
	}
	if (!isEntry(value)) return;
	if (index.header === undefined) {
		index.header = value.type === "session" && value.id === index.session;
		return;
	}
	if (!index.byId.has(value.id)) index.order.push(value.id);
	const parent = typeof value.parentId === "string" ? value.parentId : undefined;
	index.byId.set(value.id, { start, length, parent });
}

async function pageIn(file: FileHandle, index: Index, request: PageRequest): Promise<Page> {
	const limit = Math.max(1, Math.min(Math.floor(request.limit ?? PAGE), PAGE));
	if (request.since !== undefined) {
		const at = index.order.indexOf(request.since);
		if (at === -1) return { unknown: request.since };
		const after = index.order.slice(at + 1);
		return { entries: await read(file, index, after.slice(0, limit)), more: after.length > limit };
	}
	const from = request.before ?? index.order.at(-1);
	if (from === undefined) return { entries: [], more: false };
	const start = index.byId.get(from);
	if (start === undefined) return { unknown: from };
	// `before` names an entry the client holds, so its page starts at the parent. A file with a cycle
	// in its parents would page forever, so an entry seen once ends the walk.
	const seen = new Set<string>(request.before === undefined ? [] : [from]);
	let next = request.before === undefined ? from : start.parent;
	const ids: string[] = [];
	while (next !== undefined && ids.length < limit && !seen.has(next)) {
		const line = index.byId.get(next);
		if (line === undefined) break;
		seen.add(next);
		ids.push(next);
		next = line.parent;
	}
	const more = next !== undefined && index.byId.has(next) && !seen.has(next);
	return { entries: await read(file, index, ids.toReversed()), more };
}

/** The entries of `ids`, each read from its own line. */
async function read(file: FileHandle, index: Index, ids: readonly string[]): Promise<FileEntry[]> {
	const entries: FileEntry[] = [];
	for (const id of ids) {
		const line = index.byId.get(id);
		if (line === undefined) continue;
		const buffer = Buffer.alloc(line.length);
		// oxlint-disable-next-line no-await-in-loop -- a page reads up to 200 short lines, in order
		await file.read(buffer, 0, line.length, line.start);
		entries.push(JSON.parse(buffer.toString("utf8")) as FileEntry);
	}
	return entries;
}

function isEntry(value: unknown): value is FileEntry {
	return typeof value === "object" && value !== null && typeof (value as FileEntry).id === "string";
}
