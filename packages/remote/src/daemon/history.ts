// A session's history read from its file, in pages. The index keeps each entry's line and parent,
// never the entry, and reads in chunks, so a long session costs no memory the size of its file.
import { type FileHandle, open } from "node:fs/promises";

export const PAGE = 200;

/** Past this many files, the one paged longest ago is dropped. */
export const FILES = 16;

/** Bytes parsed between yields while an index is built. */
const CHUNK = 256 * 1024;

interface FileEntry {
	id: string;
	parentId?: string | null;
	[field: string]: unknown;
}

export interface PageRequest {
	before?: string;
	since?: string;
	limit?: number;
}

export type Page =
	| { entries: FileEntry[]; more: boolean }
	| { unknown: string }
	| { foreign: true };

interface Line {
	start: number;
	length: number;
	parent: string | undefined;
}

interface Index {
	session: string;
	ino: number;
	size: number;
	mtimeMs: number;
	byId: Map<string, Line>;
	order: string[];
	/** Undefined until the header line is read. */
	header?: boolean;
}

export class History {
	readonly #files = new Map<string, Index>();

	/** Keyed by path: a relaunch with the same id may page a different file. */
	forget(path: string): void {
		this.#files.delete(path);
	}

	/** The file's header must name the session. A file pi has not written yet gives an empty page. */
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

	indexed(): number {
		return this.#files.size;
	}

	async #indexed(path: string, session: string, file: FileHandle): Promise<Index> {
		const { ino, size, mtimeMs } = await file.stat();
		let index = this.#files.get(path);
		// Pi rewrites the file when it migrates it: a new inode, a shorter file or a moved last entry starts over.
		if (
			index === undefined ||
			index.session !== session ||
			index.ino !== ino ||
			size < index.size ||
			(mtimeMs !== index.mtimeMs && !(await stillHolds(file, index)))
		)
			index = { session, ino, size: 0, mtimeMs: 0, byId: new Map(), order: [] };
		this.#files.delete(path);
		this.#files.set(path, index);
		if (this.#files.size > FILES) this.#files.delete(this.#files.keys().next().value ?? path);
		if (size === index.size && mtimeMs === index.mtimeMs) return index;
		await extend(file, index, size);
		index.mtimeMs = mtimeMs;
		return index;
	}
}

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

async function extend(file: FileHandle, index: Index, size: number): Promise<void> {
	let carry = Buffer.alloc(0);
	let at = index.size;
	while (at < size) {
		const chunk = Buffer.alloc(Math.min(CHUNK, size - at));
		// oxlint-disable-next-line no-await-in-loop -- one chunk after the other, in file order
		const { bytesRead } = await file.read(chunk, 0, chunk.length, at);
		if (bytesRead === 0) break;
		at += bytesRead;
		const buffer =
			carry.length === 0
				? chunk.subarray(0, bytesRead)
				: Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
		const last = buffer.lastIndexOf(0x0a);
		if (last === -1) {
			carry = buffer;
			continue;
		}
		let from = 0;
		while (from <= last) {
			const end = buffer.indexOf(0x0a, from);
			addLine(index, buffer.subarray(from, end).toString("utf8"), index.size + from, end - from);
			from = end + 1;
		}
		index.size += last + 1;
		carry = Buffer.from(buffer.subarray(last + 1));
		// oxlint-disable-next-line no-await-in-loop -- the yield is the point
		await new Promise((resolve) => setImmediate(resolve));
	}
	// What follows the last line break is still being written.
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
	// A cycle in the parents would page forever, so an entry seen once ends the walk.
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
