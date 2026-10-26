// One log per session, followed live by other sessions and replayed later. Only the session writes
// its file and the extensions share one thread, so lines never interleave.
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readSync,
	openSync,
	closeSync,
	fstatSync,
	rmSync,
	statSync,
	watch,
} from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { LogEventMap } from "../contracts/events.ts";
import { isObject } from "../decode.ts";

export const EVENTS_VERSION = 1;
/** Every event is also published here, inside the process. */
export const LOGGED_EVENT = "harness:logged";

export type EventType = keyof LogEventMap;

export interface LoggedEvent<K extends EventType = EventType> {
	v: typeof EVENTS_VERSION;
	id: string;
	/** Milliseconds since the epoch. */
	at: number;
	session: string;
	type: K;
	data: LogEventMap[K];
	/** The pi session entry it came from, so a viewer can open that point of the conversation. */
	entry?: string;
}

/** Where a session writes: its folder's directory and its own file in it. */
export interface LogTarget {
	dir: string;
	session: string;
}

interface Bus {
	emit(channel: string, data: unknown): void;
}

export interface LogSession {
	getCwd(): string;
	getSessionId(): string;
}

/** `PI_HARNESS_EVENTS` moves every log, so tests and tools can point it elsewhere. */
export function eventsRoot(): string {
	return process.env.PI_HARNESS_EVENTS ?? join(getAgentDir(), "harness", "events");
}

/** The directory of a folder's logs, named the way pi names its session folders. */
export function eventsDir(cwd: string, root = eventsRoot()): string {
	return join(root, `--${cwd.replace(/^[/\\]+/, "").replace(/[/\\:]+/g, "-")}--`);
}

/** A folder's directory starts with `--`, so a room never takes its name. */
export function roomsDir(root = eventsRoot()): string {
	return join(root, "rooms");
}

/** The directory of a shared room's logs. */
export function roomDir(id: string, root = eventsRoot()): string {
	return join(roomsDir(root), id);
}

/** The index of the sessions open now, one small file each, so finding them reads no logs. */
export function liveDir(root = eventsRoot()): string {
	return join(root, "live");
}

export function targetOf(session: LogSession, root?: string): LogTarget {
	return { dir: eventsDir(session.getCwd(), root), session: session.getSessionId() };
}

export function logPath(target: LogTarget): string {
	return join(target.dir, `${target.session}.jsonl`);
}

let counter = 0;

/** Appends the event to the session's log and publishes it inside the process. */
export function logEvent<K extends EventType>(
	target: LogTarget,
	bus: Bus | undefined,
	type: K,
	data: LogEventMap[K],
	entry?: string,
	at = Date.now(),
): LoggedEvent<K> {
	counter = (counter + 1) % 1_296;
	const event: LoggedEvent<K> = {
		v: EVENTS_VERSION,
		id: `${at.toString(36)}${counter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`,
		at,
		session: target.session,
		type,
		data,
		...(entry === undefined ? {} : { entry }),
	};
	try {
		mkdirSync(target.dir, { recursive: true });
		appendFileSync(logPath(target), `${JSON.stringify(event)}\n`);
	} catch {
		// A log that cannot be written must never stop the session.
	}
	bus?.emit(LOGGED_EVENT, event);
	return event;
}

/** Logs from a handler's context. A context with no session behind it logs nothing. */
export function logFrom<K extends EventType>(
	ctx: { sessionManager: Partial<LogSession> },
	bus: Bus | undefined,
	type: K,
	data: LogEventMap[K],
	entry?: string,
): LoggedEvent<K> | undefined {
	const { getCwd, getSessionId } = ctx.sessionManager;
	if (getCwd === undefined || getSessionId === undefined) return undefined;
	return logEvent(targetOf(ctx.sessionManager as LogSession), bus, type, data, entry);
}

export { HOST } from "../host.ts";

/** Reads the whole events written after `offset`. A line still being written waits for the next read. */
/** Which event types a reader folds; the others are skipped before they are parsed. */
export type Wanted = (type: string) => boolean;

export function readFrom(
	path: string,
	offset: number,
	wanted?: Wanted,
): { events: LoggedEvent[]; offset: number } {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return { events: [], offset };
	}
	try {
		const size = fstatSync(fd).size;
		if (size <= offset) return { events: [], offset: size < offset ? 0 : offset };
		const buffer = Buffer.alloc(size - offset);
		readSync(fd, buffer, 0, buffer.length, offset);
		const text = buffer.toString("utf8");
		const end = text.lastIndexOf("\n");
		if (end === -1) return { events: [], offset };
		const events = text
			.slice(0, end)
			.split("\n")
			.flatMap((line) => (wanted === undefined || wanted(typeOf(line)) ? parsed(line) : []));
		return { events, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
	} finally {
		closeSync(fd);
	}
}

/** How long the log of a session that is not open stays in its folder. */
export const KEEP_LOGS_MS = 7 * 24 * 60 * 60_000;

/** Deletes the logs of sessions that are not open and have written nothing for `KEEP_LOGS_MS`. */
export function pruneLogs(dir: string, root = eventsRoot(), now = Date.now()): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		if (existsSync(join(liveDir(root), `${name.slice(0, -".jsonl".length)}.json`))) continue;
		const path = join(dir, name);
		const written = statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? now;
		if (now - written > KEEP_LOGS_MS) rmSync(path, { force: true });
	}
}

/** Reads only the end of a log, for readers that need the newest lines. */
export function readTail(path: string, bytes = TAIL_BYTES): LoggedEvent[] {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return [];
	}
	try {
		const size = fstatSync(fd).size;
		const from = Math.max(0, size - bytes);
		const buffer = Buffer.alloc(size - from);
		if (buffer.length === 0) return [];
		readSync(fd, buffer, 0, buffer.length, from);
		const text = buffer.toString("utf8");
		// The first line of a tail is usually cut in half, and half an event is not one.
		const whole = from === 0 ? text : text.slice(text.indexOf("\n") + 1);
		const end = whole.lastIndexOf("\n");
		if (end === -1) return [];
		return whole
			.slice(0, end)
			.split("\n")
			.flatMap((line) => parsed(line));
	} finally {
		closeSync(fd);
	}
}

/** Enough of a log's tail for the last commands of a long session, at a few hundred bytes each. */
const TAIL_BYTES = 512 * 1024;

/** Checks the shape, since any version may have written the line. */
function isLoggedEvent(value: unknown): value is LoggedEvent {
	return (
		isObject(value) &&
		value.v === EVENTS_VERSION &&
		typeof value.id === "string" &&
		typeof value.type === "string" &&
		typeof value.session === "string" &&
		typeof value.at === "number" &&
		isObject(value.data) &&
		(value.entry === undefined || typeof value.entry === "string")
	);
}

const TYPE_KEY = '"type":"';

/** The type of a line as `logEvent` writes it, where `type` comes before `data`. */
function typeOf(line: string): string {
	const at = line.indexOf(TYPE_KEY);
	if (at === -1) return "";
	const from = at + TYPE_KEY.length;
	return line.slice(from, line.indexOf('"', from));
}

function parsed(line: string): LoggedEvent[] {
	try {
		const value: unknown = JSON.parse(line);
		// Every field the readers use, including the one that carries the event's payload: a line that
		// lost its `data` is not an event, and reading it as one hands `undefined` to whatever folds it.
		if (!isLoggedEvent(value)) return [];
		return [value];
	} catch {
		return [];
	}
}

/** Every session's log in a folder, read from where it was left: new events, oldest first. */
export class FolderFeed {
	readonly #dir: string;
	readonly #wanted: Wanted | undefined;
	readonly #offsets = new Map<string, number>();

	constructor(dir: string, wanted?: Wanted) {
		this.#dir = dir;
		this.#wanted = wanted;
	}

	get dir(): string {
		return this.#dir;
	}

	read(): LoggedEvent[] {
		let files: string[];
		try {
			files = readdirSync(this.#dir).filter((name) => name.endsWith(".jsonl"));
		} catch {
			return [];
		}
		const fresh: LoggedEvent[] = [];
		for (const name of files) {
			const path = join(this.#dir, name);
			const { events, offset } = readFrom(path, this.#offsets.get(path) ?? 0, this.#wanted);
			this.#offsets.set(path, offset);
			fresh.push(...events);
		}
		return fresh.toSorted((a, b) => a.at - b.at || a.id.localeCompare(b.id));
	}

	/** Calls back when a log in the folder changes, or every second where watching is not there. */
	watch(changed: () => void): () => void {
		mkdirSync(this.#dir, { recursive: true });
		let timer: ReturnType<typeof setTimeout> | undefined;
		const soon = () => {
			if (timer !== undefined) return;
			timer = setTimeout(() => {
				timer = undefined;
				changed();
			}, 30);
		};
		try {
			const watcher = watch(this.#dir, soon);
			watcher.on("error", () => {});
			return () => {
				watcher.close();
				if (timer !== undefined) clearTimeout(timer);
			};
		} catch {
			const poll = setInterval(changed, 1_000);
			return () => clearInterval(poll);
		}
	}
}
