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

/**
 * What a session carries besides its conversation: the tasks beside it, the questions it asked and
 * who answered them, the ruling of each call, the permission mode, and the handle it is known by.
 * Written by the harness, and read the same way by every reader: one shape, one reducer.
 */
export interface HarnessState {
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

export function emptyHarnessState(): HarnessState {
	return { rulings: {}, asks: {} };
}

/** The questions still waiting for an answer, in the order they were asked. */
export function openAsks(facts: HarnessState): OpenAsk[] {
	return Object.values(facts.asks).filter((ask): ask is OpenAsk => ask.closed !== true);
}

/**
 * Adds one fact to the state. A fact the shape check refuses is skipped, not thrown: a log written by
 * a newer harness must not stop a client from drawing the rest.
 */
export function applyLogged(facts: HarnessState, type: string, data: unknown): HarnessState {
	if (!isFact(type, data)) return facts;
	switch (type) {
		case "tasks.changed":
			return { ...facts, tasks: (data as { state: SessionTasks }).state };
		case "call.ruled": {
			const ruled = data as { toolCallId: string; ruling: CallRuling; by?: By };
			return bound({
				...facts,
				rulings: {
					// A call ruled again moves to the end, so "the newest" is the last one the state keeps,
					// which is also the order the bound drops from. Object order is insertion order.
					...Object.fromEntries(
						Object.entries(facts.rulings).filter(([id]) => id !== ruled.toolCallId),
					),
					[ruled.toolCallId]: {
						ruling: ruled.ruling,
						...(ruled.by === undefined ? {} : { by: ruled.by }),
					},
				},
			});
		}
		case "ask.opened": {
			const opened = data as OpenAsk;
			return { ...facts, asks: { ...facts.asks, [opened.id]: opened } };
		}
		case "ask.closed": {
			const closed = data as { id: string; by?: By; result: AskResult };
			return bound({
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
			});
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

/**
 * How many closed questions and rulings a state keeps. It bounds the memory of a long session: a state
 * lives in a daemon for the whole life of a session and travels in every snapshot, so what is already
 * answered must not accumulate — a day of tool calls would carry every ruling it ever made. Open
 * questions are never dropped, because they are what a client still has to answer. The number is a
 * choice, not a measurement: it is what a client can draw without paging for older ones.
 */
export const KEPT_CLOSED = 100;

/** The state with the oldest closed questions and rulings dropped, leaving the open ones alone. */
function bound(facts: HarnessState): HarnessState {
	const closed = Object.values(facts.asks).filter((ask) => ask.closed === true);
	const open = Object.values(facts.asks).filter((ask) => ask.closed !== true);
	const kept = closed.slice(-KEPT_CLOSED);
	const asks = Object.fromEntries([...open, ...kept].map((ask) => [ask.id, ask]));
	const rulings = Object.entries(facts.rulings).slice(-KEPT_CLOSED);
	return { ...facts, asks, rulings: Object.fromEntries(rulings) };
}

/** The state after every logged event, in the order the log wrote them. */
export function applyAll(facts: readonly { type: string; data: unknown }[]): HarnessState {
	let state = emptyHarnessState();
	for (const fact of facts) state = applyLogged(state, fact.type, fact.data);
	return state;
}
