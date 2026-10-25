// A letter is one message on its way into a session, from the operator at a client or at the
// terminal, or from another agent. It is plain JSON, because it crosses the bus and the wire, and it
// names who sent it, so the same word from a phone and from an agent are told apart.
import { type By, isBy } from "../contracts/by.ts";
import { isObject } from "../decode.ts";

/** What a message becomes on the way in. `steer` goes in at once, between the agent's calls. */
export type Want = "steer" | "followUp";

/**
 * Why a letter waits, when it is not simply waiting for the run to settle: the session is asleep, a
 * chain of agents stopped waking it, a run is full of steers, or the operator stopped the run before
 * the agent read it. Absent is the ordinary case, a follow-up of the run going on.
 */
type Why = "asleep" | "quiet" | "full" | "stopped" | "not-started";

export interface Letter {
	/** Unique among the letters of one session, so a repeat in the same run is recognized. */
	id: string;
	by: By;
	text: string;
	want: Want;
	/** Set when the letter is a message of another feature, as peers' messages are, and not speech. */
	custom?: { customType: string; details?: unknown; display?: boolean };
	/** When it was written, in milliseconds, by the writer's clock. A held one shows its age. */
	at?: number;
	/** Set while the inbox holds it, and absent once it went in. */
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
