// The facts of one session, folded into what a client draws next to it: the tasks, the rulings of the
// calls in view, the open questions, the permission mode and the handle. Folding is the whole
// interface: a client that resumed from a cursor replays what it missed through the same function.

import type { By } from "../by.ts";
import { applyOne, isFactType } from "./entry.ts";
export { KEPT_CLOSED } from "./entry.ts";
import { type SESSION_STATES } from "../facts.ts";
import type {
	AskQuestion,
	AskResult,
	CallRuling,
	PermissionMode,
	SessionCommand,
	SessionTasks,
} from "../facts.ts";
import type { QueuedMessage } from "../snapshot.ts";

export interface OpenAsk {
	id: string;
	source: string;
	questions: AskQuestion[];
	expiresAt?: number;
	/** Nobody answered it yet. */
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

/**
 * What a session carries besides its conversation: the tasks beside it, the questions it asked and
 * who answered them, the ruling of each call, the permission mode, and the handle it is known by.
 * Written by the harness, and read the same way by every reader: one shape, one reducer.
 */
export interface SessionState {
	tasks?: SessionTasks;
	/** Each question the log opened, closed once their answer arrived. */
	questions: Record<string, Ask>;
	/** What the permission gate decided, and in which mode it ran. */
	permissions: {
		/** The ruling of each call, by its tool call id. */
		rulings: Record<string, { ruling: CallRuling; by?: By }>;
		/** The last mode the log recorded. */
		mode?: PermissionMode;
	};
	/** The last rename, for a mention of the older handle. */
	renamed?: { from: string; to: string; by?: By };
	/** What waits to be delivered, in the order it will go in. Empty when nothing waits. */
	queue: QueuedMessage[];
	/** What the session is doing, in pi's program status words. */
	status?: (typeof SESSION_STATES)[number];
	/** The model it answers with, how hard it thinks, and the word it is called by. */
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	name?: string;
	/**
	 * What a client may run by typing `/` into it. The host's list, not the client's: a name that is not
	 * here is refused when it is sent, so the field and the refusal cannot disagree.
	 */
	commands?: SessionCommand[];
	/**
	 * What the session has cost so far, summed from the usage pi records per message. It changes during
	 * the session, which is why it is state and not a photograph: a reader that opened the session at
	 * the first turn would otherwise draw that turn's number for the rest of the day.
	 */
	cost?: SessionCost;
}

/** One sum of a session's usage: tokens by kind, and the total in the provider's money. */
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

/** The questions still waiting for an answer, in the order they were asked. */
export function openQuestions(state: SessionState): OpenAsk[] {
	return Object.values(state.questions).filter((ask): ask is OpenAsk => ask.closed !== true);
}

/**
 * Adds one fact to the state. A fact the shape check refuses is skipped, not thrown: a log written by a
 * newer harness must not stop a client from drawing the rest.
 */
export function applyEvent(state: SessionState, type: string, data: unknown): SessionState {
	if (!isFactType(type)) return state;
	return applyOne(state, type, data);
}

/** The state after every logged event, in the order the log wrote them. */
export function foldLogged(events: readonly { type: string; data: unknown }[]): SessionState {
	let state = emptySessionState();
	for (const event of events) state = applyEvent(state, event.type, event.data);
	return state;
}
