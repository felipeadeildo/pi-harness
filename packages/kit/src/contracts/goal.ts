// A session's timeline: what it is for, what it is on now, what it finished, and what it left for
// later. Each part has a reader:
// - now: the judge reads it as your intent, and another agent reads it to know what this session
//   is on without asking it.
// - done: keeps a step from being done twice, and its notes say what a finished step left out.
// - later: what was put off, so it is not forgotten when the conversation moves on.
// The goal feature keeps it as session entries. Every change is a list of operations applied by
// `applyGoalOps`, so a branch's state can be rebuilt, and checked, from its entries alone.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

/** The custom entry type of an update. Its data is a `GoalUpdate`. */
export const GOAL_ENTRY = "pi-goal:update";
/** Asks the goal feature for the state; it fills a `GoalProbe`. */
export const GOAL_STATE = "harness:goal";
/** Sent with the new `SessionGoal` after every change. */
export const GOAL_CHANGED = "harness:goal:changed";

export const GOAL_VERSION = 1;

export type ItemStatus = "now" | "later" | "done" | "dropped";

/**
 * Where the words came from. `you`: what you wrote, in a message or on the settings screen. `work`:
 * what the agent did or said. Only `you` may say what the session is after, so a tool's output can
 * never become the intent the judge reads.
 */
export type GoalSource = "you" | "work";

/** A moment in the session: when, and the entry it happened at, so a reader can find it there. */
export interface GoalMark {
	at: number;
	/** The id of the session entry, when there was one. */
	entry?: string;
}

export interface GoalItem {
	/** Stable within the branch, like `g7`, so an item keeps its id from later to now to done. */
	id: string;
	/** Imperative, like a commit subject: `Fix the goal strip`. */
	text: string;
	/** The same step while it runs, like `Fixing the goal strip`. */
	activeForm?: string;
	status: ItemStatus;
	source: GoalSource;
	createdAt: number;
	updatedAt: number;
	/** The last time it became the current step. */
	started?: GoalMark;
	/** When it was done or dropped. */
	finished?: GoalMark;
	/**
	 * Later or dropped: why it was put off or abandoned. Done: what the step left out, the gap a
	 * later step has to close, like `tests not run`.
	 */
	note?: string;
}

export interface SessionGoal {
	version: typeof GOAL_VERSION;
	/** What the session is for, in one line. */
	goal?: string;
	/** Who set the goal. One from `work` shows on screen but is never your intent. */
	goalSource?: GoalSource;
	/** The language you write in, like `Portuguese`. Every item is written in it. */
	language?: string;
	/** Every item, in the order it was added. At most one is `now`. */
	items: GoalItem[];
	nextId: number;
	updatedAt: number;
}

export type GoalOp =
	/** Sets what the session is for. */
	| { op: "goal"; text: string }
	/** The language you write in. Only from `you`. */
	| { op: "language"; text: string }
	/** A new item becomes the current step. The one before goes back to later unless done first. */
	| { op: "start"; text: string; active?: string }
	/** An item already listed becomes the current step. */
	| { op: "resume"; id: string }
	/** The current step goes back to later, and nothing takes its place. */
	| { op: "pause"; note?: string }
	/** The current step, or the item given, is done. The note says what it left out. */
	| { op: "done"; id?: string; note?: string }
	| { op: "later"; text: string; active?: string; note?: string }
	| { op: "drop"; id: string; note?: string }
	| { op: "rename"; id: string; text: string; active?: string };

/** What set off an update. `tidy`: the pass that merges repeats and closes what the work finished. */
export type GoalTrigger = "message" | "work" | "tidy" | "you";

/** The data of a `GOAL_ENTRY`: what changed, why, and the state it left. */
export interface GoalUpdate {
	version: typeof GOAL_VERSION;
	trigger: GoalTrigger;
	ops: GoalOp[];
	/** The entries the update read, first and last, so a reader can open that stretch. */
	covers?: { from?: string; to?: string };
	/** The model that proposed the operations, like `anthropic/claude-haiku-4-5`. */
	model?: string;
	/** What that cost, in tokens and in the model's catalog price. */
	usage?: { input: number; output: number; cost: number };
	state: SessionGoal;
}

export function emptyGoal(): SessionGoal {
	return { version: GOAL_VERSION, items: [], nextId: 1, updatedAt: 0 };
}

export function nowOf(state: SessionGoal): GoalItem | undefined {
	return state.items.find((item) => item.status === "now");
}

export function itemsWith(state: SessionGoal, status: ItemStatus): GoalItem[] {
	return state.items.filter((item) => item.status === status);
}

/**
 * The state after `ops`, which runs in order. An operation that does not fit, like `done` with no
 * current step or an unknown id, is skipped. A `goal` from `work` does not replace one from `you`.
 */
export function applyGoalOps(
	state: SessionGoal,
	ops: readonly GoalOp[],
	options: { at: number; source: GoalSource; entry?: string },
): SessionGoal {
	const next: SessionGoal = { ...state, items: state.items.map((item) => ({ ...item })) };
	const { at, source } = options;
	const mark: GoalMark = options.entry === undefined ? { at } : { at, entry: options.entry };
	const find = (id: string) => next.items.find((item) => item.id === id);
	// The same words as an item already listed mean that item, not a new one.
	const listed = (text: string) =>
		next.items.find((item) => item.status !== "dropped" && sameWords(item.text, text));
	const move = (item: GoalItem, status: ItemStatus) => {
		item.status = status;
		item.updatedAt = at;
		if (status === "now") item.started = mark;
		if (status === "done" || status === "dropped") item.finished = mark;
	};
	const pauseNow = (except?: GoalItem) => {
		const current = nowOf(next);
		if (current !== undefined && current !== except) move(current, "later");
	};
	const add = (text: string, status: ItemStatus, extra: Partial<GoalItem>): GoalItem => {
		const item: GoalItem = {
			id: `g${next.nextId++}`,
			text,
			status,
			source,
			createdAt: at,
			updatedAt: at,
			...withoutEmpty(extra),
		};
		if (status === "now") item.started = mark;
		next.items.push(item);
		return item;
	};

	for (const op of ops) {
		switch (op.op) {
			case "goal": {
				const text = op.text.trim();
				// The agent's work may fill in a missing goal, never replace one you set.
				if (text === "" || (source === "work" && next.goalSource === "you")) break;
				next.goal = text;
				next.goalSource = source;
				break;
			}
			case "language":
				if (source === "you" && op.text.trim() !== "") next.language = op.text.trim();
				break;
			case "start": {
				const text = op.text.trim();
				if (text === "") break;
				const known = listed(text);
				if (known?.status === "now") break;
				pauseNow(known);
				if (known === undefined) add(text, "now", { activeForm: op.active?.trim() });
				else move(known, "now");
				break;
			}
			case "resume": {
				const item = find(op.id);
				if (item === undefined || item.status === "now") break;
				pauseNow(item);
				move(item, "now");
				break;
			}
			case "pause": {
				const current = nowOf(next);
				if (current === undefined) break;
				move(current, "later");
				if (op.note !== undefined) current.note = op.note;
				break;
			}
			case "done": {
				const item = op.id === undefined ? nowOf(next) : find(op.id);
				if (item === undefined || item.status === "done") break;
				move(item, "done");
				if (op.note !== undefined) item.note = op.note;
				break;
			}
			case "later":
				if (op.text.trim() !== "" && listed(op.text) === undefined)
					add(op.text.trim(), "later", { activeForm: op.active?.trim(), note: op.note });
				break;
			case "drop": {
				const item = find(op.id);
				// What was done stays in the history; only open items can be dropped.
				if (item === undefined || item.status === "dropped" || item.status === "done") break;
				move(item, "dropped");
				if (op.note !== undefined) item.note = op.note;
				break;
			}
			case "rename": {
				const item = find(op.id);
				if (item === undefined || op.text.trim() === "") break;
				item.text = op.text.trim();
				const active = op.active?.trim();
				if (active) item.activeForm = active;
				item.updatedAt = at;
				break;
			}
		}
	}

	next.updatedAt = at;
	return next;
}

function sameWords(left: string, right: string): boolean {
	const words = (text: string) =>
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim();
	return words(left) === words(right);
}

function withoutEmpty(extra: Partial<GoalItem>): Partial<GoalItem> {
	return Object.fromEntries(
		Object.entries(extra).filter(([, value]) => value !== undefined && value !== ""),
	);
}

/** The state a branch ends with: the last update on it. Works on entries read from a file too. */
export function goalFromEntries(entries: readonly unknown[]): SessionGoal {
	for (let index = entries.length - 1; index >= 0; index--) {
		const update = updateOf(entries[index]);
		if (update !== undefined) return update.state;
	}
	return emptyGoal();
}

/** The update an entry carries, when it is a goal entry this version can read. */
export function updateOf(entry: unknown): GoalUpdate | undefined {
	if (!isObject(entry) || entry.type !== "custom" || entry.customType !== GOAL_ENTRY)
		return undefined;
	const data = entry.data;
	if (!isObject(data) || data.version !== GOAL_VERSION || !isGoal(data.state)) return undefined;
	return data as unknown as GoalUpdate;
}

function isGoal(value: unknown): value is SessionGoal {
	return (
		isObject(value) &&
		value.version === GOAL_VERSION &&
		Array.isArray(value.items) &&
		typeof value.nextId === "number"
	);
}

/** What a probe on `GOAL_STATE` comes back with. */
export interface GoalProbe {
	state?: SessionGoal;
	/** Settles when the update your last message started is in. */
	settling?: Promise<void>;
	/** True while the agent works, when the current step reads in its running form. */
	working?: boolean;
}

/** The goal of this session, or undefined when no goal feature runs. */
export function currentGoal(events: ExtensionAPI["events"]): GoalProbe | undefined {
	const probe: GoalProbe = {};
	events.emit(GOAL_STATE, probe);
	return probe.state === undefined ? undefined : probe;
}

/** For the goal feature: answers a probe. */
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

/**
 * The state as plain text, for a prompt. `done` caps how many finished items it lists, newest
 * first; the dropped ones are left out.
 */
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

function listed(item: GoalItem): string {
	const note = item.note === undefined ? "" : ` (${item.note})`;
	return `- [${item.id}] ${item.text}${note}`;
}

/**
 * What the session is after, in your words only: the goal, and the current step when you named it.
 * The judge reads this as the operator's intent.
 */
export function intentOf(state: SessionGoal): string | undefined {
	const parts: string[] = [];
	if (state.goal !== undefined && state.goalSource !== "work") parts.push(`Goal: ${state.goal}`);
	const current = nowOf(state);
	if (current !== undefined && current.source === "you") parts.push(`Now: ${current.text}`);
	return parts.length === 0 ? undefined : parts.join("\n");
}
