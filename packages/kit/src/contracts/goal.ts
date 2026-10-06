// Other packages ask the goal feature for the live timeline over the event bus.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";
import type { SessionGoal } from "../goal/timeline.ts";

export const GOAL_STATE = "harness:goal";
/** Carries the new `SessionGoal` after every change. */
export const GOAL_CHANGED = "harness:goal:changed";
/** Your last message is in the timeline, changed or not. */
export const GOAL_SETTLED = "harness:goal:settled";

export interface GoalProbe {
	state?: SessionGoal;
	/** Your last message is not in the timeline yet. */
	pending?: boolean;
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
	extra: Omit<GoalProbe, "state">,
): void {
	if (!isObject(data)) return;
	data.state = state;
	if (extra.pending === true) data.pending = true;
	if (extra.working === true) data.working = true;
}

/** Resolves once your last message is in the timeline, or after `timeoutMs`. */
export function goalSettled(events: ExtensionAPI["events"], timeoutMs: number): Promise<void> {
	if (currentGoal(events)?.pending !== true) return Promise.resolve();
	return new Promise((resolve) => {
		const stop = events.on(GOAL_SETTLED, finish);
		const timer = setTimeout(finish, timeoutMs);
		function finish(): void {
			stop();
			clearTimeout(timer);
			resolve();
		}
	});
}
