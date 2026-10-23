// Follows a JSONL file whose records carry an `id`, such as a pi session file, reading only what was
// appended. Pi rewrites the whole file when it migrates it, keeping the ids, so the follower notices a
// rewrite and reads again from the start without handing over a record twice. The daemon bundles
// this file, so it imports nothing but `node:*`.
import { closeSync, fstatSync, openSync, readSync, watch } from "node:fs";
import { dirname } from "node:path";

/** Where a follower stands. The daemon keeps it to resume a file after a restart. */
export interface FollowState {
	/** Bytes read, always at the end of a line. */
	offset: number;
	/** The id of the record that ends at `offset`. */
	lastId: string | undefined;
	ino: number;
	size: number;
}

export interface FileRecord {
	id: string;
	[field: string]: unknown;
}

/**
 * A record, or `reset`: the file was rewritten and the last record read is gone from it, so drop
 * what came before. Every record of the file follows it.
 */
export type TailItem = { kind: "record"; record: FileRecord } | { kind: "reset" };

const START: FollowState = { offset: 0, lastId: undefined, ino: 0, size: 0 };

export class FileTail {
	readonly #path: string;
	#state: FollowState;

	constructor(path: string, from: FollowState = START) {
		this.#path = path;
		this.#state = { ...from };
	}

	get state(): FollowState {
		return { ...this.#state };
	}

	/** What the file gained since the last poll. A file that does not exist yet gives nothing. */
	poll(): TailItem[] {
		let fd: number;
		try {
			fd = openSync(this.#path, "r");
		} catch {
			return [];
		}
		try {
			return this.#read(fd);
		} finally {
			closeSync(fd);
		}
	}

	#read(fd: number): TailItem[] {
		const { ino, size } = fstatSync(fd);
		const state = this.#state;
		if (ino === state.ino && size === state.size) return [];
		const rewritten =
			(state.ino !== 0 && ino !== state.ino) ||
			size < state.offset ||
			(state.offset > 0 && idEndingAt(fd, state.offset) !== state.lastId);
		const skipTo = rewritten ? state.lastId : undefined;
		const from = rewritten ? 0 : state.offset;
		const { records, end } = readLines(fd, from, size);
		this.#state = {
			offset: end,
			lastId: records.at(-1)?.id ?? (rewritten ? undefined : state.lastId),
			ino,
			size,
		};
		if (skipTo === undefined) return records.map(asItem);
		const seen = records.findIndex((record) => record.id === skipTo);
		if (seen === -1) return [{ kind: "reset" }, ...records.map(asItem)];
		return records.slice(seen + 1).map(asItem);
	}
}

/**
 * Calls `on` with what the file gains, as it gains it, until the returned function is called. It
 * waits for a file that does not exist yet. `every` is the poll that backs up the directory watch,
 * which some filesystems never fire.
 */
export function followFile(
	path: string,
	on: (items: TailItem[]) => void,
	options: { from?: FollowState; every?: number } = {},
): () => void {
	const tail = new FileTail(path, options.from);
	let stopped = false;
	function check(): void {
		if (stopped) return;
		const items = tail.poll();
		if (items.length > 0) on(items);
	}
	const poll = setInterval(check, options.every ?? 1_000);
	poll.unref();
	const watcher = watchFolder(dirname(path), check);
	check();
	return () => {
		stopped = true;
		clearInterval(poll);
		watcher?.close();
	};
}

/** Undefined for a folder that does not exist yet, which the poll covers. */
function watchFolder(folder: string, changed: () => void): { close(): void } | undefined {
	try {
		const watcher = watch(folder, changed);
		watcher.on("error", () => {});
		return watcher;
	} catch {
		return undefined;
	}
}

function asItem(record: FileRecord): TailItem {
	return { kind: "record", record };
}

/** The complete lines in `[from, size)`, and where the last of them ends. */
function readLines(fd: number, from: number, size: number): { records: FileRecord[]; end: number } {
	if (size <= from) return { records: [], end: from };
	const buffer = Buffer.alloc(size - from);
	readSync(fd, buffer, 0, buffer.length, from);
	const last = buffer.lastIndexOf(0x0a);
	if (last === -1) return { records: [], end: from };
	const records = buffer
		.subarray(0, last)
		.toString("utf8")
		.split("\n")
		.flatMap((line) => recordOf(line));
	return { records, end: from + last + 1 };
}

/** The id of the line that ends at `offset`, reading back only as far as that line starts. */
function idEndingAt(fd: number, offset: number): string | undefined {
	for (let window = 4_096; ; window *= 2) {
		const start = Math.max(0, offset - window);
		const buffer = Buffer.alloc(offset - start);
		readSync(fd, buffer, 0, buffer.length, start);
		if (buffer.at(-1) !== 0x0a) return undefined;
		const before = buffer.lastIndexOf(0x0a, buffer.length - 2);
		if (before !== -1 || start === 0) {
			return recordOf(buffer.subarray(before + 1, -1).toString("utf8"))[0]?.id;
		}
	}
}

function recordOf(line: string): FileRecord[] {
	if (line.trim() === "") return [];
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
		if (!("id" in value) || typeof value.id !== "string") return [];
		return [value as FileRecord];
	} catch {
		return [];
	}
}
