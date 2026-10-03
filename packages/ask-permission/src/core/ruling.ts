// The line under a call that says who decided and why.
import type { CallRuling } from "@adeildo/pi-kit";

import { judgeSignalText, judgeStatText } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

export type Ruling = CallRuling;

export interface Settled {
	action: "allow" | "block";
	/** The layer that decided, `you` for the dialog. */
	by: string;
	reason?: string;
	note?: string;
}

// A rule you set, or a read that cannot hurt. A line on each of them would bury the rest.
const QUIET = new Set([
	"allow list",
	"read-only bash",
	"read-only hint",
	"codemode",
	"mode",
	"mcp",
	"workspace",
]);

export const JUDGING: Ruling = { tone: "pending", head: "judging" };

export function asking(why?: string, detail?: string): Ruling {
	return { tone: "warning", head: "asking you", why, detail };
}

export function judgeDetail(record: JudgeRecord): string {
	return [judgeSignalText(record), judgeStatText(record), record.model].join(", ");
}

/** The line once the gate settled, or undefined for a call that runs without a word. */
export function settle(settled: Settled, current: Ruling | undefined): Ruling | undefined {
	const { action, by, note } = settled;
	const reason = settled.reason?.replace(`${NAME}: `, "");
	if (by === "you") {
		const why = current?.why === undefined ? undefined : `asked because ${current.why}`;
		return action === "allow"
			? { tone: "success", head: "you approved", why, note, detail: current?.detail }
			: { tone: "error", head: "you said no", why, note, detail: current?.detail };
	}
	if (by === "judge") {
		const ruling = { why: current?.why ?? reason, detail: current?.detail };
		return action === "allow"
			? { tone: "success", head: "judge approved", ...ruling }
			: { tone: "error", head: "judge denied", ...ruling };
	}
	if (by === "always yes") return { tone: "success", head: "always yes" };
	if (action === "block") return { tone: "error", head: "blocked", why: reason };
	if (by === "no UI")
		return { tone: "success", head: "allowed", why: "nobody can answer, and noUI allows it" };
	return QUIET.has(by) ? undefined : { tone: "success", head: "allowed", why: by };
}
