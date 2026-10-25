// The envelope every message crosses a process in. A shape only grows: a field that changes meaning
// gets a new name, and a break gets v: 2.

import { isBy, isObject, type By } from "./by.ts";

/** The protocol version. A peer that speaks another one is refused in the hello, not half read. */
export const PROTOCOL = 1;

export type EnvelopeKind = "hello" | "event" | "state" | "command" | "reply" | "error";

export interface Envelope {
	v: typeof PROTOCOL;
	kind: EnvelopeKind;
	/** The machine that owns the session. Absent for messages about the connection itself. */
	machine?: string;
	/** pi's session id. */
	session?: string;
	/** The life of the pi process that sent it. */
	epoch?: string;
	/** Per epoch, increasing, assigned by the bridge. A delta has none: it only matters live. */
	seq?: number;
	/** Pairs a command with its reply, and makes a resent command a repeat. */
	id?: string;
	type: string;
	data: unknown;
	at: number;
	/** Who caused it. */
	by?: By;
}

export const KINDS: readonly EnvelopeKind[] = [
	"hello",
	"event",
	"state",
	"command",
	"reply",
	"error",
];

/**
 * Whether a value is an envelope this version reads. A message from a newer version is refused here,
 * where the reason can still be shown, instead of failing somewhere the shape is used.
 */
export function isEnvelope(value: unknown): value is Envelope {
	return (
		isObject(value) &&
		value.v === PROTOCOL &&
		typeof value.kind === "string" &&
		KINDS.some((kind) => kind === value.kind) &&
		typeof value.type === "string" &&
		typeof value.at === "number" &&
		(value.machine === undefined || typeof value.machine === "string") &&
		(value.session === undefined || typeof value.session === "string") &&
		(value.epoch === undefined || typeof value.epoch === "string") &&
		(value.seq === undefined || (Number.isInteger(value.seq) && (value.seq as number) >= 0)) &&
		(value.id === undefined || typeof value.id === "string") &&
		(value.by === undefined || isBy(value.by))
	);
}

/** Builds an envelope, so a sender cannot forget the version or the time. */
export function envelope(
	kind: EnvelopeKind,
	type: string,
	data: unknown,
	around: Omit<Envelope, "v" | "kind" | "type" | "data" | "at"> = {},
): Envelope {
	return { v: PROTOCOL, kind, type, data, at: Date.now(), ...around };
}
