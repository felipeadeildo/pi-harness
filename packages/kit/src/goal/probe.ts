// Other packages ask the goal feature for the live timeline over the event bus.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";
import type { SessionGoal } from "./timeline.ts";

export const GOAL_STATE = "harness:goal";
/** Carries the new `SessionGoal` after every change. */
export const GOAL_CHANGED = "harness:goal:changed";

export interface GoalProbe {
	state?: SessionGoal;
	/** Settles once your last message is in the timeline. */
	settling?: Promise<void>;
	working?: boolean;
}

export function currentGoal(events: ExtensionAPI["events"]): GoalProbe | undefined {
	const probe: GoalProbe = {};
	events.emit(GOAL_STATE, probe);
	return probe.state === undefined ? undefined : probe;
}

export function answerGoal(
	data: unknown,
	state: SessionGoal,
	extra: { settling?: Promise<void>; working?: boolean } = {},
): void {
	if (!isObject(data)) return;
	data.state = state;
	if (extra.settling !== undefined) data.settling = extra.settling;
	if (extra.working === true) data.working = true;
}
