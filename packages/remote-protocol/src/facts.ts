// The shapes the harness writes to its log, copied here because the client reads them without the
// kit. A copy is only safe while a test proves it matches, which `test/conformance.test.ts` does.

import { isBy, isObject, type By } from "./by.ts";

export type TaskStatus = "doing" | "queued" | "waiting" | "deferred" | "done" | "dropped";
export type Origin = "you" | "agent";
export type WaitingOn = "you" | "outside";

export interface Mark {
	at: number;
	entry?: string;
}

export interface Task {
	id: string;
	text: string;
	status: TaskStatus;
	origin: Origin;
	created: Mark;
	asks: string[];
	started?: Mark;
	finished?: Mark;
	updatedAt: number;
	result?: string;
	left?: string;
	why?: string;
	waitingOn?: WaitingOn;
	idleRuns?: number;
}

export interface Decision {
	id: string;
	text: string;
	origin: Origin;
	made: Mark;
	tasks?: string[];
}

/** The session's tasks, as `tasks.changed` carries them. */
export interface SessionTasks {
	version: 1;
	title?: string;
	titleOrigin?: Origin;
	handle?: string;
	language?: string;
	tasks: Task[];
	decisions: Decision[];
	nextTask: number;
	nextDecision: number;
	updatedAt: number;
}

export interface AskOption {
	label: string;
	description?: string;
	preview?: string;
}

export interface AskQuestion {
	header: string;
	question: string;
	options: AskOption[];
	multiSelect?: boolean;
	typed?: boolean;
}

export interface AskNote {
	option: string;
	note: string;
}

export interface AskAnswer {
	question: string;
	header: string;
	picked: string[];
	typed?: string;
	notes: AskNote[];
}

export interface AskResult {
	answers: AskAnswer[];
	cancelled: boolean;
	error?: string;
}

export type RulingTone = "pending" | "success" | "warning" | "error";

/** What decided a tool call, and why. */
export interface CallRuling {
	tone: RulingTone;
	head: string;
	why?: string;
	note?: string;
	detail?: string;
	blocked?: boolean;
}

export type PermissionMode = "manual" | "edits" | "judge" | "full";

/** Every fact the client reduces, with the shape each carries. */
export interface FactMap {
	"tasks.changed": { state: SessionTasks };
	"ask.opened": { id: string; source: string; questions: AskQuestion[]; expiresAt?: number };
	"ask.closed": { id: string; by?: By; result: AskResult };
	"call.ruled": { toolCallId: string; ruling: CallRuling; by?: By };
	"mode.changed": { mode: PermissionMode };
	"session.renamed": { from: string; to: string; by?: By };
	"session.state": { state: "working" | "blocked" | "done" | "error" | "idle" };
	"session.live": {
		pid?: number;
		startedAt?: number;
		cwd?: string;
		name?: string;
		kind: "terminal" | "background";
	};
	"session.gone": { reason: "exit" | "crash" | "unanswered" | "replaced" };
	/** pi numbers its streams per message start, so the same number the transcript carries. */
	"stream.bound": { messages: { stream: number; entry: string }[] };
	/** The entry the branch ends at, or null when a `/tree` move goes back to the root. */
	"leaf.changed": { leaf: string | null };
	"prompt.received": { by?: By };
}

export type FactType = keyof FactMap;

export const FACT_TYPES: readonly FactType[] = [
	"tasks.changed",
	"ask.opened",
	"ask.closed",
	"call.ruled",
	"mode.changed",
	"session.renamed",
	"session.state",
	"session.live",
	"session.gone",
	"stream.bound",
	"leaf.changed",
	"prompt.received",
];

/**
 * Whether a fact carries the shape its name promises. Only the fields the reducers read are checked:
 * a fact written by a newer harness still reduces as long as the old fields are there.
 */
export function isFact(type: string, data: unknown): boolean {
	if (!isObject(data)) return false;
	switch (type) {
		case "tasks.changed":
			return isTasks(data.state);
		case "ask.opened":
			return typeof data.id === "string" && Array.isArray(data.questions);
		case "ask.closed":
			return typeof data.id === "string" && isObject(data.result);
		case "call.ruled":
			return (
				typeof data.toolCallId === "string" &&
				isObject(data.ruling) &&
				typeof data.ruling.head === "string" &&
				typeof data.ruling.tone === "string"
			);
		case "mode.changed":
			return (
				data.mode === "manual" ||
				data.mode === "edits" ||
				data.mode === "judge" ||
				data.mode === "full"
			);
		case "session.state":
			return typeof data.state === "string";
		case "stream.bound":
			return Array.isArray(data.messages);
		case "leaf.changed":
			return data.leaf === null || typeof data.leaf === "string";
		case "prompt.received":
		case "session.renamed":
			return data.by === undefined || isBy(data.by);
		default:
			return true;
	}
}

function isTasks(value: unknown): value is SessionTasks {
	return (
		isObject(value) &&
		value.version === 1 &&
		Array.isArray(value.tasks) &&
		Array.isArray(value.decisions)
	);
}
