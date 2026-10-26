// What decided a tool call, published by the deciding feature and read by whoever frames the call.
import { defineContract } from "../contract.ts";
import { boolean, guarded, isObject } from "../decode.ts";

export const RULING_TONES = ["pending", "success", "warning", "error"] as const;

export type RulingTone = (typeof RULING_TONES)[number];

export interface CallRuling {
	tone: RulingTone;
	head: string;
	why?: string;
	note?: string;
	detail?: string;
	blocked?: boolean;
}

/** Keyed by tool call id. */
export const RULING = defineContract<CallRuling, string>(
	"calls:ruling",
	guarded(isRuling, "a ruling with a tone and a head"),
);

/** A feature that frames every call answers true, so the ruling is not drawn twice. */
export const CALLS_FRAMED = defineContract<boolean>("calls:framed", boolean);

function isRuling(value: unknown): value is CallRuling {
	return (
		isObject(value) &&
		typeof value.head === "string" &&
		RULING_TONES.some((tone) => tone === value.tone)
	);
}

/** In the order they are worth trying. */
export const TARGET_FIELDS = ["path", "file_path", "command", "query", "url", "pattern"] as const;

/** The path, command or query, cut to its first line; empty when the arguments name nothing. */
export function callTarget(args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	for (const field of TARGET_FIELDS) {
		const value = fields[field];
		if (typeof value === "string" && value.trim() !== "") return value.split("\n")[0] ?? "";
	}
	return "";
}
