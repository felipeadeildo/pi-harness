// The sessions open on this machine, one small file each, so a reader finds who is open without
// reading every folder's logs. It is an index, not a record: the logs stay the record, and nothing
// replays this.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SessionState } from "../contracts/events.ts";
import { isObject } from "../decode.ts";
import { HOST, liveDir } from "../events/log.ts";
import { processLives } from "./process.ts";

export { ownStart, processLives, processStart, startFromStat, startsFromPs } from "./process.ts";

export interface PresenceEntry {
	session: string;
	pid: number;
	/** When the process started, from `processStart`. Entries written before it was recorded lack it. */
	start?: string;
	host: string;
	cwd: string;
	/** pi's session file, so a reader can open the session read only. */
	file?: string;
	handle?: string;
	title?: string;
	state: SessionState;
	/** When the session opened, which orders the list. */
	startedAt: number;
	/** When the entry last changed. */
	at: number;
}

/** Whether the process of an entry runs, given its pid and the start it recorded. */
export type Lives = (pid: number, start: string | undefined) => boolean;

export interface PresenceReading {
	/** Judges the entries of this machine. Defaults to `processLives`. */
	lives?: Lives;
	/** This machine. Defaults to the hostname. */
	host?: string;
	/** The events root the index lives under. Defaults to the harness's. */
	root?: string;
}

function pathOf(session: string, root?: string): string {
	return join(liveDir(root), `${session}.json`);
}

/**
 * Writes this session's entry. It goes to a temporary file first and is renamed into place, and the
 * rename is what keeps a reader from meeting half an entry; a test can see that the file was
 * replaced, though no test can race a reader against the write. Failing to write must never stop
 * the session.
 */
export function writePresence(entry: PresenceEntry, root?: string): void {
	const path = pathOf(entry.session, root);
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		mkdirSync(liveDir(root), { recursive: true });
		writeFileSync(temporary, JSON.stringify(entry));
		renameSync(temporary, path);
	} catch {
		// Without the index, this session is only harder to find.
		removeQuietly(temporary);
	}
}

/**
 * Removes this session's entry. Like a write, failing to must never stop the session: an entry left
 * behind with no process is dropped by every reader.
 */
export function removePresence(session: string, root?: string): void {
	removeQuietly(pathOf(session, root));
}

function removeQuietly(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {
		// Nothing to undo: the file was never there, or the folder cannot be written.
	}
}

/**
 * The sessions open now, oldest first. A session that crashed leaves its file behind, so an entry of
 * this machine whose process no longer runs is left out. Entries of other machines are kept.
 */
export function readPresence(reading: PresenceReading = {}): PresenceEntry[] {
	const { lives = processLives, host = HOST, root } = reading;
	let names: string[];
	try {
		names = readdirSync(liveDir(root)).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
	return names
		.flatMap((name) => {
			const entry = parsed(join(liveDir(root), name));
			if (entry === undefined) return [];
			return entry.host === host && !lives(entry.pid, entry.start) ? [] : [entry];
		})
		.toSorted((a, b) => a.startedAt - b.startedAt || a.session.localeCompare(b.session));
}

function parsed(path: string): PresenceEntry | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		const ok =
			isObject(value) &&
			typeof value.session === "string" &&
			typeof value.pid === "number" &&
			typeof value.host === "string" &&
			typeof value.cwd === "string" &&
			typeof value.state === "string" &&
			typeof value.startedAt === "number" &&
			typeof value.at === "number" &&
			optionalString(value.start) &&
			optionalString(value.file);
		return ok ? (value as unknown as PresenceEntry) : undefined;
	} catch {
		return undefined;
	}
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}
