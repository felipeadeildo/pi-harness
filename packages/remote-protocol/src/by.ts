// The kit has the same type; `test/conformance.test.ts` keeps the two together.

export interface By {
	kind: "terminal" | "client" | "agent";
	/** The handle for a terminal or an agent; the device's name for a client. */
	name: string;
	/** The hostname. */
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
