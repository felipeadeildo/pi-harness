// The goal on Alt+S, to read whole and to correct by hand. What you write here counts as yours.
// The session's goal titles its section, and the timeline is listed under it.
import {
	type FeatureScope,
	type GoalOp,
	goalFromEntries,
	goalSpent,
	itemsWith,
	nowOf,
	type ScreenEntry,
	type SessionGoal,
} from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { GoalKeeper } from "./index.ts";
import { MODEL_SECTION } from "./settings.ts";

const UNTITLED = "This session";

/** The section the timeline sits in: the session's goal, once there is one. */
export function sessionSection(ctx: ExtensionContext | undefined): string {
	const goal = ctx === undefined ? undefined : goalFromEntries(ctx.sessionManager.getBranch()).goal;
	return goal ?? UNTITLED;
}

export function registerScreen(scope: FeatureScope, keeper: GoalKeeper): void {
	scope.screen.rows((ctx) => timelineRows(keeper, sessionSection(ctx)));

	scope.screen.info({
		id: "goal.spent",
		section: MODEL_SECTION,
		label: "Spent",
		description:
			"What the goal's model calls cost on this branch, at the model's catalog price. The look adds it to the session's cost.",
		text: (ctx) => spentText(goalSpent(ctx.sessionManager.getBranch())),
	});
}

function timelineRows(keeper: GoalKeeper, section: string): ScreenEntry[] {
	return [
		{
			kind: "value",
			id: "goal.now",
			section,
			label: "Now",
			description: "The step under way. Empty marks it done. A line from Later picks that one up.",
			control: { type: "text" },
			get: () => nowOf(keeper.state())?.text ?? "",
			text: () => (nowOf(keeper.state()) === undefined ? "nothing under way" : undefined),
			set: (value) => {
				if (typeof value !== "string") return "expected text";
				keeper.apply(nowOps(keeper.state(), value.trim()), "you");
				return undefined;
			},
		},
		{
			kind: "value",
			id: "goal.later",
			section,
			label: "Later",
			description: "What was left for afterwards, one per line. A line you remove is dropped.",
			control: { type: "text", multiline: true },
			get: () =>
				itemsWith(keeper.state(), "later")
					.map((item) => item.text)
					.join("\n"),
			text: () => count(itemsWith(keeper.state(), "later").length),
			set: (value) => {
				if (typeof value !== "string") return "expected text";
				keeper.apply(laterOps(keeper.state(), value), "you");
				return undefined;
			},
		},
		{
			kind: "action",
			id: "goal.done",
			section,
			label: "Done",
			description: "What this session finished, oldest first.",
			text: () => count(itemsWith(keeper.state(), "done").length),
			run: () => doneText(keeper.state()),
		},
		{
			kind: "value",
			id: "goal.goal",
			section,
			label: "Goal",
			description:
				"What this session is for, which titles this section. The model sets it from your messages; Enter edits it.",
			control: { type: "text" },
			get: () => keeper.state().goal ?? "",
			text: () => (keeper.state().goal === undefined ? "not set yet" : "the title above"),
			set: (value) => {
				if (typeof value !== "string" || value.trim() === "")
					return "write what the session is for";
				keeper.apply([{ op: "goal", text: value }], "you");
				return undefined;
			},
		},
	];
}

export function nowOps(state: SessionGoal, text: string): GoalOp[] {
	const current = nowOf(state);
	if (text === "") return current === undefined ? [] : [{ op: "done" }];
	if (current?.text === text) return [];
	const listed = itemsWith(state, "later").find((item) => item.text === text);
	return listed === undefined ? [{ op: "start", text }] : [{ op: "resume", id: listed.id }];
}

export function laterOps(state: SessionGoal, text: string): GoalOp[] {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const later = itemsWith(state, "later");
	const dropped: GoalOp[] = later
		.filter((item) => !lines.includes(item.text))
		.map((item) => ({ op: "drop", id: item.id }));
	const added: GoalOp[] = lines
		.filter((line) => !later.some((item) => item.text === line))
		.map((line) => ({ op: "later", text: line }));
	return [...dropped, ...added];
}

function spentText(spent: ReturnType<typeof goalSpent>): string {
	if (spent.calls === 0) return "nothing yet";
	const calls = spent.calls === 1 ? "1 call" : `${spent.calls} calls`;
	return `$${spent.cost.toFixed(3)}, ${calls}`;
}

function doneText(state: SessionGoal): string {
	const done = itemsWith(state, "done");
	if (done.length === 0) return "Nothing done yet.";
	return done.map((item) => `${clock(item.updatedAt)}  ${item.text}`).join("\n");
}

function clock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function count(size: number): string {
	if (size === 0) return "none";
	return size === 1 ? "1 item" : `${size} items`;
}
