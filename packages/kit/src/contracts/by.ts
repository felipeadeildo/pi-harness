// Who caused a fact. A fact a person or an agent can cause carries one on disk, on the wire and
// inside the process, so a reader tells the operator at the terminal from the operator on a phone,
// and both from an agent.
import { hostname } from "node:os";

import { isObject } from "../decode.ts";

export interface By {
	/** The operator at a pi's terminal, the operator at a client such as a phone, or an agent. */
	kind: "terminal" | "client" | "agent";
	/** The session's handle for a terminal or an agent, and the device's name for a client. */
	name: string;
	/** Where it happened: the hostname, until machines have ids. */
	machine: string;
}

/** The part of pi's session manager that says which session this is. */
export interface NamedSession {
	getSessionId(): string;
	getSessionName(): string | undefined;
}

/**
 * A session as the `by` of what happens in it. The name is pi's session name, or `new-` and the
 * last four characters of the id while it has none, as peers shows an untitled session.
 */
export function bySession(kind: By["kind"], session: NamedSession, machine = hostname()): By {
	const name = session.getSessionName() ?? `new-${session.getSessionId().slice(-4)}`;
	return { kind, name, machine };
}

const KINDS: ReadonlySet<string> = new Set<By["kind"]>(["terminal", "client", "agent"]);

export function isBy(value: unknown): value is By {
	return (
		isObject(value) &&
		typeof value.kind === "string" &&
		KINDS.has(value.kind) &&
		typeof value.name === "string" &&
		typeof value.machine === "string"
	);
}
