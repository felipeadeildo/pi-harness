// Every message crosses a process in one. Shapes only grow: a changed meaning gets a new name, a break gets v: 2.

import { isBy, isObject, type By } from "./by.ts";

/** A peer that speaks another version is refused in the hello. */
export const PROTOCOL = 1;

export type EnvelopeKind = "hello" | "event" | "state" | "command" | "reply" | "error";

export interface Envelope {
	v: typeof PROTOCOL;
	kind: EnvelopeKind;
	/** Absent for messages about the connection itself. */
	machine?: string;
	session?: string;
	epoch?: string;
	/** Per epoch, increasing, from the bridge. A delta has none: it only matters live. */
	seq?: number;
	/** Pairs a command with its reply, and makes a resend a repeat. */
	id?: string;
	type: string;
	data: unknown;
	at: number;
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

/** Refuses a newer version here, where the reason can still be shown. */
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

export function envelope(
	kind: EnvelopeKind,
	type: string,
	data: unknown,
	around: Omit<Envelope, "v" | "kind" | "type" | "data" | "at"> = {},
): Envelope {
	return { v: PROTOCOL, kind, type, data, at: Date.now(), ...around };
}
