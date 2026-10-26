// Who caused a state change: the operator at the terminal, the operator on a phone, or an agent.
import { isObject } from "../decode.ts";

export interface By {
	/** The operator at a pi's terminal, the operator at a client such as a phone, or an agent. */
	kind: "terminal" | "client" | "agent";
	/** The session's handle for a terminal or an agent, and the device's name for a client. */
	name: string;
	/** Where it happened: the hostname, until machines have ids. */
	machine: string;
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
