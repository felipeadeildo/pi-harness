// One small file per open session, so readers find who is open without reading the logs. The
// remote daemon also writes the owner's other machines' sessions here.
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { RoomActivity } from "../contracts/events.ts";
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
	state: RoomActivity;
	/** When the session opened, which orders the list. */
	startedAt: number;
	/** When the entry last changed. */
	at: number;
}

/** Whether the process of an entry runs, given its pid and the start it recorded. */
export type Lives = (pid: number, start: string | undefined) => boolean;

/** The daemon rewrites them every two seconds while the machine answers. */
export const ELSEWHERE_FOR_MS = 15_000;

export interface PresenceReading {
	/** Judges the entries of this machine. Defaults to `processLives`. */
	lives?: Lives;
	/** This machine. Defaults to the hostname. */
	host?: string;
	/** The events root the index lives under. Defaults to the harness's. */
	root?: string;
	now?: () => number;
}

function pathOf(session: string, root?: string): string {
	return join(liveDir(root), `${session}.json`);
}

/** Renamed into place, so no reader meets half an entry. Never throws. */
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

/** Leaves out a crashed session's entry, and another machine's not rewritten within `ELSEWHERE_FOR_MS`. */
export function readPresence(reading: PresenceReading = {}): PresenceEntry[] {
	const { lives = processLives, host = HOST, root, now = Date.now } = reading;
	let names: string[];
	try {
		names = readdirSync(liveDir(root)).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
	return names
		.flatMap((name) => {
			const path = join(liveDir(root), name);
			const entry = parsed(path);
			if (entry === undefined) return [];
			if (entry.host === host) return lives(entry.pid, entry.start) ? [entry] : [];
			return now() - writtenAt(path) < ELSEWHERE_FOR_MS ? [entry] : [];
		})
		.toSorted((a, b) => a.startedAt - b.startedAt || a.session.localeCompare(b.session));
}

/** The sessions open on the owner's other machines, as their daemons last said. */
export function openElsewhere(reading: PresenceReading = {}): Set<string> {
	const host = reading.host ?? HOST;
	return new Set(
		readPresence(reading)
			.filter((entry) => entry.host !== host)
			.map((entry) => entry.session),
	);
}

function isPresenceEntry(value: unknown): value is PresenceEntry {
	return (
		isObject(value) &&
		typeof value.session === "string" &&
		typeof value.pid === "number" &&
		typeof value.host === "string" &&
		typeof value.cwd === "string" &&
		(value.state === "running" || value.state === "idle") &&
		typeof value.startedAt === "number" &&
		typeof value.at === "number" &&
		optionalString(value.start) &&
		optionalString(value.file) &&
		optionalString(value.handle)
	);
}

function writtenAt(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

function parsed(path: string): PresenceEntry | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isPresenceEntry(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}
