// The facts of one session, folded into what a client draws next to it: the tasks, the rulings of the
// calls in view, the open questions, the permission mode and the handle. Folding is the whole
// interface: a client that resumed from a cursor replays what it missed through the same function.

import type { By } from "../by.ts";
import {
	isFact,
	type AskQuestion,
	type AskResult,
	type CallRuling,
	type PermissionMode,
	type SessionTasks,
} from "../facts.ts";

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

/** Everything the log can change about a session, kept the way a reader asks for it. */
export interface SessionFacts {
	tasks?: SessionTasks;
	/** The ruling of each call, by its tool call id. */
	rulings: Record<string, { ruling: CallRuling; by?: By }>;
	/** Each question the log opened, closed once its answer arrived. */
	asks: Record<string, Ask>;
	/** The last mode the log recorded. */
	mode?: PermissionMode;
	/** The last rename, for a mention of the older handle. */
	renamed?: { from: string; to: string; by?: By };
}

export function emptySessionFacts(): SessionFacts {
	return { rulings: {}, asks: {} };
}

/** The questions still waiting for an answer, in the order they were asked. */
export function openAsks(facts: SessionFacts): OpenAsk[] {
	return Object.values(facts.asks).filter((ask): ask is OpenAsk => ask.closed !== true);
}

/**
 * Adds one fact to the state. A fact the shape check refuses is skipped, not thrown: a log written by
 * a newer harness must not stop a client from drawing the rest.
 */
export function reduceFact(facts: SessionFacts, type: string, data: unknown): SessionFacts {
	if (!isFact(type, data)) return facts;
	switch (type) {
		case "tasks.changed":
			return { ...facts, tasks: (data as { state: SessionTasks }).state };
		case "call.ruled": {
			const ruled = data as { toolCallId: string; ruling: CallRuling; by?: By };
			return {
				...facts,
				rulings: {
					...facts.rulings,
					[ruled.toolCallId]: {
						ruling: ruled.ruling,
						...(ruled.by === undefined ? {} : { by: ruled.by }),
					},
				},
			};
		}
		case "ask.opened": {
			const opened = data as OpenAsk;
			return { ...facts, asks: { ...facts.asks, [opened.id]: opened } };
		}
		case "ask.closed": {
			const closed = data as { id: string; by?: By; result: AskResult };
			return {
				...facts,
				asks: {
					...facts.asks,
					[closed.id]: {
						id: closed.id,
						result: closed.result,
						closed: true,
						...(closed.by === undefined ? {} : { by: closed.by }),
					},
				},
			};
		}
		case "mode.changed":
			return { ...facts, mode: (data as { mode: PermissionMode }).mode };
		case "session.renamed": {
			const renamed = data as { from: string; to: string; by?: By };
			return { ...facts, renamed };
		}
		default:
			return facts;
	}
}

/** The state after every fact, in the order the log wrote them. */
export function reduceFacts(facts: readonly { type: string; data: unknown }[]): SessionFacts {
	let state = emptySessionFacts();
	for (const fact of facts) state = reduceFact(state, fact.type, fact.data);
	return state;
}
