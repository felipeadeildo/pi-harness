// Everything that shows a session reads it from a source, and the same screens draw whatever source
// they are given: this pi, a session file on this machine, and once remote lands, another pi through
// the daemon or another machine through a link. See docs/remote.md, "Sources and shells".
//
// A source is an object with functions, so it travels on raw channels, which pass it by reference
// inside the process, and not through `defineContract`, whose values are JSON.
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

/** The live state of a session, what its entries do not say. It only grows. */
export interface SessionSnapshot {
	session: string;
	/** The machine the session runs on: its hostname, until machines get ids. */
	machine: string;
	cwd: string;
	name?: string;
	/** The entry the conversation continues from. Pi draws the branch from it back to the root. */
	leafId?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	/**
	 * Tokens in the context, as of the last answer. `window` is missing where the source cannot know
	 * it, such as a file, and the reader looks the model up in its own registry.
	 */
	context?: { tokens: number; window?: number };
}

/** Where a follower stands. It only grows, as sources learn to resume more than the entries. */
export interface SourceCursor {
	/** The last pi session entry it holds. */
	entry?: string;
}

/**
 * - `entry`: one of pi's session entries, the durable part.
 * - `snapshot`: the live state, once the entries held so far are sent, and again when it changes.
 * - `reset`: the source does not know the cursor it was given, or lost its place. Drop every entry
 *   held for this session: the entries from the start follow.
 * - `ended`: the session closed, and nothing more comes.
 */
export type SourceItem =
	| { kind: "entry"; entry: SessionEntry }
	| { kind: "snapshot"; snapshot: SessionSnapshot }
	| { kind: "reset" }
	| { kind: "ended" };

export interface SessionSource {
	snapshot(): Promise<SessionSnapshot>;
	/**
	 * Calls `on` with what comes after `after`, or everything from the start without it, then with what
	 * comes live, until the returned function is called.
	 */
	follow(after: SourceCursor | undefined, on: (item: SourceItem) => void): () => void;
}

/** Which session to show. `file` lets a session of this machine be read without anyone's help. */
export interface SourceAddress {
	session: string;
	machine: string;
	file?: string;
}

/** Remote answers here with its daemon and link sources. The kit's file source is the fallback. */
export const SOURCES = "harness:sources";
/** A request to show a session over the screen. The look answers it. */
export const VIEW_OPEN = "harness:view.open";
/** A view provider answers this to say it can show a session right now. */
export const VIEW_AVAILABLE = "harness:view.available";

interface SourceRequest {
	address: SourceAddress;
	source?: SessionSource;
}

/** Answers source requests. An undefined answer leaves the address to another provider. */
export function provideSources(
	events: Events,
	answer: (address: SourceAddress) => SessionSource | undefined,
): () => void {
	return events.on(SOURCES, (data) => {
		const request = data as SourceRequest;
		if (!isObject(data) || request.source !== undefined || !isAddress(request.address)) return;
		request.source = answer(request.address);
	});
}

/** The source a provider gives for `address`, if one does. */
export function askSource(events: Events, address: SourceAddress): SessionSource | undefined {
	const request: SourceRequest = { address };
	events.emit(SOURCES, request);
	return request.source;
}

/** True when a feature in this process can show a session right now. */
export function canOpenView(events: Events): boolean {
	const probe = { available: false };
	events.emit(VIEW_AVAILABLE, probe);
	return probe.available;
}

/** Asks for `address` to be shown. False when nobody took the request. */
export function openView(events: Events, address: SourceAddress): boolean {
	const request = { address, opened: false };
	events.emit(VIEW_OPEN, request);
	return request.opened;
}

/** Shows sessions: says it is available, and takes a request when `open` returns true. */
export function provideViews(
	events: Events,
	open: (address: SourceAddress) => boolean,
	available: () => boolean = () => true,
): () => void {
	const stops = [
		events.on(VIEW_AVAILABLE, (data) => {
			if (isObject(data) && available()) data.available = true;
		}),
		events.on(VIEW_OPEN, (data) => {
			if (!isObject(data) || data.opened === true || !isAddress(data.address)) return;
			data.opened = open(data.address);
		}),
	];
	return () => {
		for (const stop of stops) stop();
	};
}

function isAddress(value: unknown): value is SourceAddress {
	return (
		isObject(value) &&
		typeof value.session === "string" &&
		typeof value.machine === "string" &&
		(value.file === undefined || typeof value.file === "string")
	);
}
