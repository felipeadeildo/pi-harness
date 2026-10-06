// The goal on Alt+S, to read whole and to correct by hand. What you write here counts as yours.
import {
	type FeatureScope,
	type GoalOp,
	goalSpent,
	itemsWith,
	nowOf,
	type SessionGoal,
} from "@adeildo/pi-kit";

import type { GoalKeeper } from "./index.ts";
import { MODEL_SECTION, SESSION_SECTION } from "./settings.ts";

export function registerScreen(scope: FeatureScope, keeper: GoalKeeper): void {
	scope.screen.value({
		id: "goal.goal",
		section: SESSION_SECTION,
		label: "Goal",
		description: "What this session is for. The model sets it from your messages.",
		control: { type: "text" },
		get: () => keeper.state().goal ?? "",
		set: (value) => {
			if (typeof value !== "string" || value.trim() === "") return "write what the session is for";
			keeper.apply([{ op: "goal", text: value }], "you");
			return undefined;
		},
	});

	scope.screen.value({
		id: "goal.now",
		section: SESSION_SECTION,
		label: "Now",
		description: "The step under way. Empty marks it done. A line from Later picks that one up.",
		control: { type: "text" },
		get: () => nowOf(keeper.state())?.text ?? "",
		set: (value) => {
			if (typeof value !== "string") return "expected text";
			keeper.apply(nowOps(keeper.state(), value.trim()), "you");
			return undefined;
		},
	});

	scope.screen.value({
		id: "goal.later",
		section: SESSION_SECTION,
		label: "Later",
		description: "What was left for afterwards, one per line. A line you remove is dropped.",
		control: { type: "text", multiline: true },
		get: () =>
			itemsWith(keeper.state(), "later")
				.map((item) => item.text)
				.join("\n"),
		set: (value) => {
			if (typeof value !== "string") return "expected text";
			keeper.apply(laterOps(keeper.state(), value), "you");
			return undefined;
		},
	});

	scope.screen.action({
		id: "goal.done",
		section: SESSION_SECTION,
		label: "Done",
		description: "What this session finished, oldest first.",
		text: () => count(itemsWith(keeper.state(), "done").length),
		run: () => doneText(keeper.state()),
	});

	scope.screen.info({
		id: "goal.spent",
		section: MODEL_SECTION,
		label: "Spent",
		description:
			"What the goal's model calls cost on this branch, at the model's catalog price. The look adds it to the session's cost.",
		text: (ctx) => spentText(goalSpent(ctx.sessionManager.getBranch())),
	});
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
	return size === 1 ? "1 item" : `${size} items`;
}
