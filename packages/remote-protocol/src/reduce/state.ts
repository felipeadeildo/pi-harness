// The facts of one session, folded into what a client draws next to it: the tasks, the rulings of the
// calls in view, the open questions, the permission mode and the handle. Folding is the whole
// interface: a client that resumed from a cursor replays what it missed through the same function.

import type { By } from "../by.ts";
import {
	isFact,
	SESSION_STATES,
	type AskQuestion,
	type AskResult,
	type CallRuling,
	type PermissionMode,
	type SessionTasks,
} from "../facts.ts";
import { type QueuedMessage } from "../snapshot.ts";

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
}

export function emptySessionState(): SessionState {
	return { questions: {}, permissions: { rulings: {} }, queue: [] };
}

/** The questions still waiting for an answer, in the order they were asked. */
export function openQuestions(state: SessionState): OpenAsk[] {
	return Object.values(state.questions).filter((ask): ask is OpenAsk => ask.closed !== true);
}

/**
 * Adds one fact to the state. A fact the shape check refuses is skipped, not thrown: a log written by
 * a newer harness must not stop a client from drawing the rest.
 */
export function applyEvent(state: SessionState, type: string, data: unknown): SessionState {
	if (!isFact(type, data)) return state;
	switch (type) {
		case "tasks.changed":
			return { ...state, tasks: (data as { state: SessionTasks }).state };
		case "call.ruled": {
			const ruled = data as { toolCallId: string; ruling: CallRuling; by?: By };
			return bound({
				...state,
				permissions: {
					...state.permissions,
					rulings: {
						// A call ruled again moves to the end, so "the newest" is the last one the state
						// keeps, which is also the order the bound drops from. Object order is insertion.
						...Object.fromEntries(
							Object.entries(state.permissions.rulings).filter(([id]) => id !== ruled.toolCallId),
						),
						[ruled.toolCallId]: {
							ruling: ruled.ruling,
							...(ruled.by === undefined ? {} : { by: ruled.by }),
						},
					},
				},
			});
		}
		case "ask.opened": {
			const opened = data as OpenAsk;
			return { ...state, questions: { ...state.questions, [opened.id]: opened } };
		}
		case "ask.closed": {
			const closed = data as { id: string; by?: By; result: AskResult };
			const before = state.questions[closed.id];
			return bound({
				...state,
				questions: {
					...state.questions,
					[closed.id]: {
						id: closed.id,
						result: closed.result,
						closed: true,
						// A second answer does not erase who gave the first one: only a named one wins.
						...(closed.by !== undefined
							? { by: closed.by }
							: before?.closed === true && before.by !== undefined
								? { by: before.by }
								: {}),
					},
				},
			});
		}
		case "session.status": {
			const { status } = data as { status: SessionState["status"] };
			return { ...state, status };
		}
		case "session.live": {
			const live = data as { name?: string; model?: SessionState["model"]; thinkingLevel?: string };
			// Absence means "not said here", so a live event that names only the folder leaves the rest.
			return {
				...state,
				...(live.name === undefined ? {} : { name: live.name }),
				...(live.model === undefined ? {} : { model: live.model }),
				...(live.thinkingLevel === undefined ? {} : { thinkingLevel: live.thinkingLevel }),
			};
		}
		case "queue.changed": {
			const { queue } = data as { queue: QueuedMessage[] };
			return { ...state, queue };
		}
		case "mode.changed":
			return {
				...state,
				permissions: { ...state.permissions, mode: (data as { mode: PermissionMode }).mode },
			};
		case "session.renamed": {
			const renamed = data as { from: string; to: string; by?: By };
			return { ...state, renamed };
		}
		default:
			return state;
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
function bound(state: SessionState): SessionState {
	const closed = Object.values(state.questions).filter((ask) => ask.closed === true);
	const open = Object.values(state.questions).filter((ask) => ask.closed !== true);
	const kept = closed.slice(-KEPT_CLOSED);
	const questions = Object.fromEntries([...open, ...kept].map((ask) => [ask.id, ask]));
	const rulings = Object.entries(state.permissions.rulings).slice(-KEPT_CLOSED);
	return {
		...state,
		questions,
		permissions: { ...state.permissions, rulings: Object.fromEntries(rulings) },
	};
}

/** The state after every logged event, in the order the log wrote them. */
export function foldLogged(events: readonly { type: string; data: unknown }[]): SessionState {
	let state = emptySessionState();
	for (const event of events) state = applyEvent(state, event.type, event.data);
	return state;
}
