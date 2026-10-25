// The shapes the harness writes to its log, copied here because the client reads them without the
// kit. A copy is only safe while a test proves it matches, which `test/conformance.test.ts` does.

import { type By } from "./by.ts";
import type { SessionCost } from "./reduce/state.ts";
import type { QueuedMessage } from "./snapshot.ts";

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

/**
 * How hard pi is asked to think, in pi's own order and words. One list, because the screen that offers
 * the choice and the bridge that validates it must not drift apart.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** One of the levels above. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * One slash command a client may use, and where it comes from. It lives here, with the other shapes the
 * wire carries, and the reducer imports it from here: the state is a reading of these facts, not their
 * owner.
 */
export interface SessionCommand {
	/** The name as pi knows it, without the slash. */
	name: string;
	description?: string;
	/**
	 * `skill` and `prompt` reach the model expanded; `pi` is a command this harness answers itself, which
	 * today is `compact`. An extension command never appears here: it runs only at the terminal.
	 */
	source: "skill" | "prompt" | "pi";
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

/** A session's status in pi's program status words, as `session.status` carries it. */
export const SESSION_STATES = ["working", "blocked", "done", "error", "idle"] as const;

/** Every fact the client reduces, with the shape each carries. */
export interface FactMap {
	"tasks.changed": { state: SessionTasks };
	"ask.opened": { id: string; source: string; questions: AskQuestion[]; expiresAt?: number };
	"ask.closed": { id: string; by?: By; result: AskResult };
	"call.ruled": { toolCallId: string; ruling: CallRuling; by?: By };
	"mode.changed": { mode: PermissionMode };
	"session.renamed": { from: string; to: string; by?: By };
	"session.status": { status: (typeof SESSION_STATES)[number] };
	"session.live": {
		pid?: number;
		startedAt?: number;
		cwd?: string;
		name?: string;
		kind: "terminal" | "background";
		/** The model this session answers with, and how hard it thinks, as pi reports them live. */
		model?: { provider: string; id: string };
		thinkingLevel?: string;
		/**
		 * pi's session file, which the daemon pages older entries from. pi knows the path from the
		 * start, but writes the file only with the first message, so until then a page finds nothing:
		 * `ENOENT` means no older entries yet. Absent only with `--no-session`.
		 */
		file?: string;
		/** What a client may run by typing `/`, which this session offers at this instant. */
		commands?: SessionCommand[];
	};
	"session.gone": { reason: "exit" | "crash" | "unanswered" | "replaced" };
	/** The bridge numbers each message it streams, from 1 in each epoch; `pi.message_start` carries the same number. */
	"stream.bound": { messages: { stream: number; entry: string }[] };
	/** The entry the branch ends at, or null when a `/tree` move goes back to the root. */
	"leaf.changed": { leaf: string | null };
	/** Always written with who sent it, since that is the whole fact; read leniently, see `isFact`. */
	"prompt.received": { by: By };
	/** The whole queue as it stands: it waits in the session, so every client sees the same list. */
	"queue.changed": { queue: QueuedMessage[] };
	/** What the session has cost so far, summed by the bridge from pi's per-message usage. */
	"cost.changed": { cost: SessionCost };
}

export type FactType = keyof FactMap;
