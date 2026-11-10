// Starting pi in a folder from another piece: peers asks, and the remote starts it through its
// daemon. A raw channel, like the views': whoever provides it fills the answer.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

export const SESSION_START = "harness:session.start";

/** Set on a pi another session started, naming it. The remote's daemon keeps its own copy. */
export const STARTED_BY_ENV = "PI_STARTED_BY";

export interface StartRequest {
	/** Absolute, or under `~`. */
	folder: string;
	/** The new pi's first message. */
	prompt?: string;
	/** Another of the owner's machines; this one when absent. */
	machine?: string;
	/** The session that asks; the new pi gets it as `PI_STARTED_BY`. */
	by?: string;
}

export type Started = { machine: string; session: string } | { reason: string };

/** Undefined when no piece here starts sessions, as when the remote is not installed. */
export function startSession(events: Events, request: StartRequest): Promise<Started> | undefined {
	const asked: { request: StartRequest; answer?: Promise<Started> } = { request };
	events.emit(SESSION_START, asked);
	return asked.answer;
}

export function provideSessionStart(
	events: Events,
	start: (request: StartRequest) => Promise<Started>,
): () => void {
	return events.on(SESSION_START, (data) => {
		if (!isObject(data) || data.answer !== undefined || !isStartRequest(data.request)) return;
		data.answer = start(data.request);
	});
}

function isStartRequest(value: unknown): value is StartRequest {
	return (
		isObject(value) &&
		typeof value.folder === "string" &&
		(value.prompt === undefined || typeof value.prompt === "string") &&
		(value.machine === undefined || typeof value.machine === "string") &&
		(value.by === undefined || typeof value.by === "string")
	);
}
