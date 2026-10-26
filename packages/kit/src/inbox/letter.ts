// One message on its way into a session, as JSON, with who sent it.
import { type By, isBy } from "../contracts/by.ts";
import { isObject } from "../decode.ts";

/** `steer` goes in at once, between the agent's calls. */
export type Want = "steer" | "followUp";

/** Absent for the ordinary case, a follow-up waiting for the run to settle. */
type Why = "asleep" | "quiet" | "full" | "stopped" | "not-started";

export interface Letter {
	/** Unique within the session, so a repeat in the same run is recognized. */
	id: string;
	by: By;
	text: string;
	want: Want;
	/** A message of another feature, as peers' are, not speech. */
	custom?: { customType: string; details?: unknown; display?: boolean };
	/** By the writer's clock; a held letter shows its age. */
	at?: number;
	why?: Why;
}

export function isLetter(value: unknown): value is Letter {
	if (!isObject(value)) return false;
	if (typeof value.id !== "string" || value.id === "") return false;
	if (typeof value.text !== "string") return false;
	if (value.want !== "steer" && value.want !== "followUp") return false;
	if (!isBy(value.by)) return false;
	if (value.at !== undefined && typeof value.at !== "number") return false;
	if (value.why !== undefined && !WHYS.has(value.why as string)) return false;
	return value.custom === undefined || isCustom(value.custom);
}

const WHYS: ReadonlySet<string> = new Set<Why>([
	"asleep",
	"quiet",
	"full",
	"stopped",
	"not-started",
]);

function isCustom(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.customType === "string" &&
		value.customType !== "" &&
		(value.details === undefined || isObject(value.details) || Array.isArray(value.details)) &&
		(value.display === undefined || typeof value.display === "boolean")
	);
}
