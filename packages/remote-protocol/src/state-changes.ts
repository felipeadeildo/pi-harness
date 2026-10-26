// The log's shapes, copied so the client reads them without the kit; `test/conformance.test.ts`
// keeps the copy in step.

export type { StateChangeMap, StateChangeType } from "./reduce/entry.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** One of the levels above. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface SessionCommand {
	/** The name as pi knows it, without the slash. */
	name: string;
	description?: string;
	/** `skill` and `prompt` reach the model expanded; `pi` is a harness command. Extension commands never appear. */
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

/** `provider` and `id` are what `model.set` takes. */
export interface ModelOption {
	provider: string;
	id: string;
	name: string;
}
