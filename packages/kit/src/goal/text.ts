import { type GoalItem, itemsWith, nowOf, type SessionGoal } from "./timeline.ts";

/** The timeline as a prompt reads it, with ids. `done` caps the finished items, newest first. */
export function describeGoal(state: SessionGoal, options: { done?: number } = {}): string {
	const lines: string[] = [];
	if (state.goal !== undefined) lines.push(`Goal: ${state.goal}`);
	const current = nowOf(state);
	if (current !== undefined) lines.push(`Now: [${current.id}] ${current.text}`);
	const later = itemsWith(state, "later");
	if (later.length > 0) lines.push("Later:", ...later.map(listed));
	const done = itemsWith(state, "done")
		.toReversed()
		.slice(0, options.done ?? Infinity);
	if (done.length > 0) lines.push("Done:", ...done.map(listed));
	return lines.join("\n");
}

/** Your intent for the judge: the goal and the current step, only where they came from you. */
export function intentOf(state: SessionGoal): string | undefined {
	const parts: string[] = [];
	if (state.goal !== undefined && state.goalSource !== "work") parts.push(`Goal: ${state.goal}`);
	const current = nowOf(state);
	if (current !== undefined && current.source === "you") parts.push(`Now: ${current.text}`);
	return parts.length === 0 ? undefined : parts.join("\n");
}

function listed(item: GoalItem): string {
	const note = item.note === undefined ? "" : ` (${item.note})`;
	return `- [${item.id}] ${item.text}${note}`;
}
