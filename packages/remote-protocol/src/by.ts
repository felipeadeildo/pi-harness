// Who caused a state change. The kit has the same type, and the copy is deliberate: this package ships to the
// Expo app, which cannot carry the kit or pi behind it. `test/conformance.test.ts` holds the two
// together, so they can drift in no direction.

export interface By {
	/** The operator at a pi's terminal, the operator at a client such as a phone, or an agent. */
	kind: "terminal" | "client" | "agent";
	/** The session's handle for a terminal or an agent, and the device's name for a client. */
	name: string;
	/** Where it happened: the hostname, until machines have ids. */
	machine: string;
}

export const BY_KINDS: readonly By["kind"][] = ["terminal", "client", "agent"];

export function isBy(value: unknown): value is By {
	return (
		isObject(value) &&
		typeof value.kind === "string" &&
		BY_KINDS.some((kind) => kind === value.kind) &&
		typeof value.name === "string" &&
		typeof value.machine === "string"
	);
}

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
