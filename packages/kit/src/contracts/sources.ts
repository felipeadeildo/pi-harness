// Everything that shows a session reads it from a source, and the same screens draw whatever source
// they are given: this pi, a session file on this machine, and once remote lands, another pi through
// the daemon or another machine through a link.
//
// A source is an object with functions, so it travels on raw channels, which pass it by reference
// inside the process, and not through `defineContract`, whose values are JSON.
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

/** What a session's entries do not say, which only grows. */
export interface SessionSummary {
	session: string;
	/** The machine the session runs on: its hostname, until machines get ids. */
	machine: string;
	cwd: string;
	/**
	 * The session's title, as pi stores it with `/name`: what a screen puts at the top. Not the handle a room mentions it by, which is the presence's.
	 */
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

export interface SourceCursor {
	/** The last pi session entry it holds. */
	entry?: string;
}

/**
 * - `entry`: one of pi's session entries, the durable part.
 * - `snapshot`: the live state, once the entries held so far are sent, and again when it changes.
 * - `reset`: the source does not know the cursor it was given, or lost its place. A cursor with none
 *   of the fields the source reads counts as unknown. Drop every entry held for this session: the
 *   entries from the start follow.
 * - `ended`: the session closed, and nothing more comes.
 */
export type SourceItem =
	| { kind: "entry"; entry: SessionEntry }
	| { kind: "summary"; summary: SessionSummary }
	| { kind: "reset" }
	| { kind: "ended" };

export interface SessionSource {
	open(): Promise<SessionSummary>;
	/**
	 * Calls `on` with what comes after `after`, or everything from the start without it, then with what
	 * comes live, until the returned function is called. What the source already holds may come before
	 * `follow` returns.
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
		if (!isObject(data) || request.source !== undefined || !isSourceAddress(request.address))
			return;
		request.source = answer(request.address);
	});
}

/** The source a provider gives for `address`, if one does. */
export function askSource(events: Events, address: SourceAddress): SessionSource | undefined {
	const request: SourceRequest = { address };
	events.emit(SOURCES, request);
	return request.source;
}

export function isSourceAddress(value: unknown): value is SourceAddress {
	return (
		isObject(value) &&
		typeof value.session === "string" &&
		typeof value.machine === "string" &&
		(value.file === undefined || typeof value.file === "string")
	);
}
