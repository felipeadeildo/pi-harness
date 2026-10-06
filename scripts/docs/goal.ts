// The goal's pictures, built by applying the operations the goal's model sends, so they show
// what the package keeps.
import type { Theme } from "@earendil-works/pi-coding-agent";

import { TimelineView } from "../../packages/goal/src/view.ts";
import {
	applyGoalOps,
	emptyGoal,
	type GoalOp,
	type SessionGoal,
} from "../../packages/kit/src/index.ts";
import { KEYS, WIDTH } from "./drive.ts";

const MINUTE = 60_000;
/** 14:00 on the clock the pictures read. */
const START = Date.UTC(2026, 9, 6, 14, 0);

/** The minute a change happened, and the operations sent then. */
type Step = [minute: number, ops: GoalOp[]];

/** The session the Alt+G picture shows. */
const TIMELINE: Step[] = [
	[0, [{ op: "goal", text: "Make the goal timeline trustworthy" }]],
	[0, [{ op: "start", text: "Add the goal to the roadmap" }]],
	[6, [{ op: "done", id: "g1" }]],
	[7, [{ op: "start", text: "Measure the timeline against real sessions" }]],
	[24, [{ op: "done", id: "g2" }]],
	[25, [{ op: "start", text: "Start a step at the message that asked for it" }]],
	[33, [{ op: "done", id: "g3" }]],
	[34, [{ op: "start", text: "Read a named skill as the ask it is" }]],
	[41, [{ op: "done", id: "g4", note: "a skill without a description still reads as a command" }]],
	[
		42,
		[
			{
				op: "later",
				text: "Frame the user's message",
				note: "pi has no hook for it yet",
			},
		],
	],
	[43, [{ op: "start", text: "Check every close against the session's words" }]],
	[
		52,
		[
			{
				op: "later",
				text: "Let the agent's work open a step on your words",
				note: 'measure the "what\'s next?" case first: the model may copy the question as proof',
			},
		],
	],
];

/** The session the look's pictures show: a fix made, and now being published. */
const SHIPPING: Step[] = [
	[0, [{ op: "goal", text: "Keep the answer on one line" }]],
	[0, [{ op: "start", text: "Find where the answer wraps" }]],
	[9, [{ op: "done", id: "g1" }]],
	[10, [{ op: "start", text: "Keep the answer on one line" }]],
	[31, [{ op: "done", id: "g2" }]],
	[32, [{ op: "later", text: "Say in the README how the answer fits", note: "after the release" }]],
	[33, [{ op: "start", text: "Publish the one-line answer" }]],
];

function played(steps: readonly Step[]): SessionGoal {
	let state: SessionGoal = { ...emptyGoal(), updatedAt: START };
	for (const [minute, ops] of steps)
		state = applyGoalOps(state, ops, { at: START + minute * MINUTE, source: "you" });
	return state;
}

/** The goal on the look's strip. */
export function shippingGoal(): SessionGoal {
	return played(SHIPPING);
}

/** Hours and minutes in UTC, so the picture is the same on every machine. */
function clock(at: number): string {
	return new Date(at).toISOString().slice(11, 16);
}

/** `Alt+G` open, with the cursor moved to the first item that waits. */
export function goalTimeline(theme: Theme): string[] {
	const state = played(TIMELINE);
	const view = new TimelineView({
		theme,
		state: () => state,
		spent: () => ({ cost: 0.041, calls: 19 }),
		rows: () => 30,
		close: () => {},
		requestRender: () => {},
		clock,
	});
	view.handleInput(KEYS.down);
	return view.render(WIDTH);
}
