// What a session is working toward, the step under way, what it finished and what it put off.

export const GOAL_VERSION = 1;

export type ItemStatus = "now" | "later" | "done" | "dropped";

/** Only `you` reaches the judge, so a tool's output can never become your intent. */
export type GoalSource = "you" | "work";

export interface GoalMark {
	at: number;
	entry?: string;
}

export interface GoalItem {
	/** Like `g7`, kept from later to now to done. */
	id: string;
	/** Imperative, like a changelog line: `Show the goal on the top strip`. */
	text: string;
	/** The same item while it runs: `Showing the goal on the top strip`. */
	activeForm?: string;
	status: ItemStatus;
	source: GoalSource;
	createdAt: number;
	updatedAt: number;
	started?: GoalMark;
	finished?: GoalMark;
	/** Later or dropped: why. Done: what it left out, for a later step to close. */
	note?: string;
}

export interface SessionGoal {
	version: typeof GOAL_VERSION;
	goal?: string;
	goalSource?: GoalSource;
	/** The language of your messages, like `Portuguese`. */
	language?: string;
	/** In the order they were added. At most one is `now`. */
	items: GoalItem[];
	nextId: number;
	updatedAt: number;
}

/** `proof`: the words of the session that show a step finished or was given up. */
export type GoalOp =
	| { op: "goal"; text: string }
	| { op: "language"; text: string }
	| { op: "start"; text: string; active?: string }
	| { op: "resume"; id: string }
	| { op: "reopen"; id: string; proof?: string }
	| { op: "pause"; note?: string }
	| { op: "done"; id?: string; note?: string; proof?: string }
	| { op: "later"; text: string; active?: string; note?: string }
	| { op: "drop"; id: string; note?: string; proof?: string }
	| { op: "rename"; id: string; text: string; active?: string };

/** `tidy`: the pass after a run that merges repeats and closes finished items. */
export type GoalTrigger = "message" | "work" | "tidy" | "you";

export function emptyGoal(): SessionGoal {
	return { version: GOAL_VERSION, items: [], nextId: 1, updatedAt: 0 };
}

export function nowOf(state: SessionGoal): GoalItem | undefined {
	return state.items.find((item) => item.status === "now");
}

export function itemsWith(state: SessionGoal, status: ItemStatus): GoalItem[] {
	return state.items.filter((item) => item.status === status);
}
