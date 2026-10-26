// Screens draw a session from a source: this pi, a session file, or a remote one. A source holds
// functions, so it travels on raw channels rather than `defineContract`, whose values are JSON.
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

/** What a session's entries do not say, which only grows. */
export interface SessionSummary {
	session: string;
	/** The machine the session runs on: its hostname, until machines get ids. */
	machine: string;
	cwd: string;
	/** Pi's `/name`, not the room's handle. */
	name?: string;
	/** The entry the conversation continues from. Pi draws the branch from it back to the root. */
	leafId?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	/** `window` is missing where the source cannot know it, such as a file. */
	context?: { tokens: number; window?: number };
}

export interface SourceCursor {
	/** The last pi session entry it holds. */
	entry?: string;
}

/** `reset`: the source lost its place, so drop what was held; everything follows from the start. */
export type SourceItem =
	| { kind: "entry"; entry: SessionEntry }
	| { kind: "summary"; summary: SessionSummary }
	| { kind: "reset" }
	| { kind: "ended" };

export interface SessionSource {
	open(): Promise<SessionSummary>;
	/** Follows from `after`, or from the start, until the returned function is called. */
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
