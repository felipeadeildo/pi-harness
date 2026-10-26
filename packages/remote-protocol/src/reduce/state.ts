// The state of one session, folded by the same function on the server and on every client.

import type { BoardView } from "../board-view.ts";
import type { By } from "../by.ts";
import type { QueuedMessage } from "../summary.ts";
import { applyOne, isStateChangeType } from "./entry.ts";
export { KEPT_CLOSED } from "./entry.ts";
import { type SESSION_STATES } from "../state-changes.ts";
import type {
	AskQuestion,
	AskResult,
	CallRuling,
	ModelOption,
	PermissionMode,
	PromptKind,
	SessionCommand,
} from "../state-changes.ts";
import type { StateChangeType } from "../state-changes.ts";

export interface OpenAsk {
	id: string;
	source: string;
	questions: AskQuestion[];
	expiresAt?: number;
	closed?: never;
}

export interface ClosedAsk {
	id: string;
	/** Who answered, when a person did. A judge or an expiry answers for nobody. */
	by?: By;
	result: AskResult;
	closed: true;
}

export type Ask = OpenAsk | ClosedAsk;

export interface SessionState {
	questions: Record<string, Ask>;
	/** What the permission gate decided, and in which mode it ran. */
	permissions: {
		rulings: Record<string, { ruling: CallRuling; by?: By }>;
		mode?: PermissionMode;
		/** Absent until a bridge said: "not said yet" is not "cannot". */
		serves?: boolean;
	};
	/** What the session's board holds. Absent when no feature provides one, which is not an empty board. */
	board?: BoardView;
	/** Theme color names; a client resolves them in its own palette. */
	theme?: { accent: string; color?: string };
	/** What waits to be delivered, in the order it will go in. Empty when nothing waits. */
	queue: QueuedMessage[];
	/** What the session is doing, in pi's program status words. */
	status?: (typeof SESSION_STATES)[number];
	/** The model it answers with, how hard it thinks, and the word it is called by. */
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	name?: string;
	/** The host's list, so the field and the refusal cannot disagree. */
	commands?: SessionCommand[];
	/** Who sent the prompts that came from a client, by entry id: the transcript says where they came from. */
	promptFrom?: Record<string, By>;
	/** Absent until a bridge said: a picker waits on absent and says so on empty. */
	models?: ModelOption[];
	/** How many models the registry listed, which is more than `models` holds when the list was cut. */
	modelsTotal?: number;
	/** The dialog the terminal waits on that no client can answer, while it is open. */
	prompt?: { kind: PromptKind; title?: string };
	/** Changes every turn, so it lives in the state. */
	cost?: SessionCost;
}

export interface SessionCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export function emptySessionState(): SessionState {
	return { questions: {}, permissions: { rulings: {} }, queue: [] };
}

export function openQuestions(state: SessionState): OpenAsk[] {
	return Object.values(state.questions).filter((ask): ask is OpenAsk => ask.closed !== true);
}

/** A change the check refuses is skipped, so a newer harness's log still draws. */
export function applyChange(
	state: SessionState,
	type: StateChangeType,
	data: unknown,
): SessionState {
	return applyOne(state, type, data);
}

export function foldLogged(events: readonly { type: string; data: unknown }[]): SessionState {
	let state = emptySessionState();
	for (const event of events) {
		// The log holds more than state changes; the type of the field is the whole reason to ask.
		if (isStateChangeType(event.type)) state = applyChange(state, event.type, event.data);
	}
	return state;
}
