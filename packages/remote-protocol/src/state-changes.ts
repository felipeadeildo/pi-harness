// The shapes the harness writes to its log, copied here because the client reads them without the
// kit. A copy is only safe while a test proves it matches, which `test/conformance.test.ts` does. The
// map of every state change is read from the reducer's table, where each shape sits with its check.

export type { StateChangeMap, StateChangeType } from "./reduce/entry.ts";

/**
 * How hard pi is asked to think, in pi's own order and words. One list, because the screen that offers
 * the choice and the bridge that validates it must not drift apart.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** One of the levels above. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * One slash command a client may use, and where it comes from. It lives here, with the other shapes the
 * wire carries, and the reducer imports it from here: the state is a reading of these state changes, not their
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

/** The blocking dialogs only the terminal can answer: a client can race for the others. */
export const PROMPT_KINDS = ["editor", "custom"] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];

/**
 * A model the session could switch to, as far as a client needs to pick one: `provider` and `id` are what
 * `model.set` takes, `name` is what the person reads and searches. Nothing about how the provider is
 * reached: the list goes to every client signed in.
 */
export interface ModelOption {
	provider: string;
	id: string;
	name: string;
}
