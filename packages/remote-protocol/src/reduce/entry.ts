// One entry per state change: the shape it must carry, and what it does to the state. Written as a table so a
// change added to `StateChangeMap` does not compile until somebody says both — one with a shape and
// no effect is a shape nobody folds, and one with an effect and no check is a reader trusting the wire.

import { isBy, isObject } from "../by.ts";
import { SESSION_STATES, type StateChangeMap, type StateChangeType } from "../state-changes.ts";
import { type QueuedMessage } from "../summary.ts";
import type { SessionState } from "./state.ts";

/** One state change: what it must carry, and what it leaves behind. */
export interface Entry<T> {
	check(data: unknown): data is T;
	apply(state: SessionState, data: T): SessionState;
}

const unchanged = (state: SessionState): SessionState => state;

/**
 * How many closed questions and rulings a state keeps. It bounds the memory of a long session: a state
 * lives in a daemon for the whole life of a session and travels in every snapshot, so what is already
 * answered must not accumulate. Open questions are never dropped, because they are what a client still
 * has to answer. The number is a choice, not a measurement.
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

/** Every state change the protocol knows, each with its check and its effect. */
export const CHANGES: { [K in StateChangeType]: Entry<StateChangeMap[K]> } = {
	"tasks.changed": {
		check: (data): data is StateChangeMap["tasks.changed"] => isObject(data) && isTasks(data.state),
		apply: (state, data) => ({ ...state, tasks: data.state }),
	},
	"call.ruled": {
		check: (data): data is StateChangeMap["call.ruled"] =>
			isObject(data) &&
			typeof data.toolCallId === "string" &&
			isObject(data.ruling) &&
			typeof data.ruling.head === "string" &&
			typeof data.ruling.tone === "string",
		apply: (state, data) =>
			bound({
				...state,
				permissions: {
					...state.permissions,
					rulings: {
						// A call ruled again moves to the end, so "the newest" is the last one the state
						// keeps, which is also the order the bound drops from. Object order is insertion.
						...Object.fromEntries(
							Object.entries(state.permissions.rulings).filter(([id]) => id !== data.toolCallId),
						),
						[data.toolCallId]: {
							ruling: data.ruling,
							...(data.by === undefined ? {} : { by: data.by }),
						},
					},
				},
			}),
	},
	"ask.opened": {
		check: (data): data is StateChangeMap["ask.opened"] =>
			isObject(data) && typeof data.id === "string" && Array.isArray(data.questions),
		apply: (state, data) => ({
			...state,
			questions: { ...state.questions, [data.id]: data },
		}),
	},
	"ask.closed": {
		check: (data): data is StateChangeMap["ask.closed"] =>
			isObject(data) && typeof data.id === "string" && isObject(data.result),
		apply: (state, data) => {
			const before = state.questions[data.id];
			return bound({
				...state,
				questions: {
					...state.questions,
					[data.id]: {
						id: data.id,
						result: data.result,
						closed: true,
						// A second answer does not erase who gave the first one: only a named one wins.
						...(data.by !== undefined
							? { by: data.by }
							: before?.closed === true && before.by !== undefined
								? { by: before.by }
								: {}),
					},
				},
			});
		},
	},
	"mode.changed": {
		check: (data): data is StateChangeMap["mode.changed"] =>
			isObject(data) &&
			(data.mode === "manual" ||
				data.mode === "edits" ||
				data.mode === "judge" ||
				data.mode === "full"),
		apply: (state, data) => ({
			...state,
			permissions: { ...state.permissions, mode: data.mode },
		}),
	},
	"session.renamed": {
		check: (data): data is StateChangeMap["session.renamed"] =>
			isObject(data) && (data.by === undefined || isBy(data.by)),
		apply: (state, data) => ({ ...state, renamed: data }),
	},
	"session.status": {
		// pi's program status words only: the log's own `session.state` is peers' running or idle, and a
		// line of it must never read as a status.
		check: (data): data is StateChangeMap["session.status"] =>
			isObject(data) && SESSION_STATES.some((status) => status === data.status),
		apply: (state, data) => ({ ...state, status: data.status }),
	},
	"session.live": {
		// The list is the contract the composer and the refusal both read: a `source` this version does
		// not know would be drawn by the screen and misjudged by the wire, so it is refused here.
		check: (data): data is StateChangeMap["session.live"] =>
			isObject(data) &&
			(data.commands === undefined ||
				(Array.isArray(data.commands) &&
					data.commands.every(
						(one: unknown) =>
							isObject(one) &&
							typeof one.name === "string" &&
							(one.source === "skill" || one.source === "prompt" || one.source === "pi"),
					))),
		apply: (state, data) => ({
			...state,
			// Absence means "not said here", so a live event that names only the folder leaves the rest.
			...(data.name === undefined ? {} : { name: data.name }),
			...(data.model === undefined ? {} : { model: data.model }),
			...(data.thinkingLevel === undefined ? {} : { thinkingLevel: data.thinkingLevel }),
			...(data.commands === undefined ? {} : { commands: data.commands }),
		}),
	},
	"session.gone": {
		check: (data): data is StateChangeMap["session.gone"] =>
			isObject(data) &&
			(data.reason === "exit" ||
				data.reason === "crash" ||
				data.reason === "unanswered" ||
				data.reason === "replaced"),
		// A session that ended is news to the daemon and to the screen; the state it left stays.
		apply: unchanged,
	},
	"stream.bound": {
		// The number matters: a stream that is not pi's number cannot be matched to a transcript.
		check: (data): data is StateChangeMap["stream.bound"] =>
			isObject(data) &&
			Array.isArray(data.messages) &&
			data.messages.every(
				(message: unknown) =>
					isObject(message) &&
					typeof message.stream === "number" &&
					typeof message.entry === "string",
			),
		apply: unchanged,
	},
	"leaf.changed": {
		check: (data): data is StateChangeMap["leaf.changed"] =>
			isObject(data) && (data.leaf === null || typeof data.leaf === "string"),
		// Where the branch ends is the stream's cursor, not the state's: the entries carry the leaf.
		apply: unchanged,
	},
	"prompt.received": {
		// A prompt that reached the log names who sent it; anything else is not this state change.
		check: (data): data is StateChangeMap["prompt.received"] => isObject(data) && isBy(data.by),
		apply: unchanged,
	},
	"queue.changed": {
		check: (data): data is StateChangeMap["queue.changed"] =>
			isObject(data) && Array.isArray(data.queue) && data.queue.every(isQueuedMessage),
		apply: (state, data) => ({ ...state, queue: data.queue }),
	},
	"cost.changed": {
		// Every number a reader sums: a `NaN` here would be drawn as `$NaN` and kept for the day.
		check: (data): data is StateChangeMap["cost.changed"] => isObject(data) && isCost(data.cost),
		apply: (state, data) => ({ ...state, cost: data.cost }),
	},
};

/** Every state change this version folds, derived from the table so the two cannot drift. */
export const STATE_CHANGES: readonly StateChangeType[] = Object.keys(CHANGES) as StateChangeType[];

/** Whether a string names a state change this version folds. */
export function isStateChangeType(type: string): type is StateChangeType {
	return Object.hasOwn(CHANGES, type);
}

/** Folds one state change, through the entry that owns it. One a check refuses leaves the state alone. */
export function applyOne<K extends StateChangeType>(
	state: SessionState,
	type: K,
	data: unknown,
): SessionState {
	const entry = CHANGES[type];
	return entry.check(data) ? entry.apply(state, data) : state;
}

function isTasks(value: unknown): value is StateChangeMap["tasks.changed"]["state"] {
	return (
		isObject(value) &&
		value.version === 1 &&
		Array.isArray(value.tasks) &&
		Array.isArray(value.decisions)
	);
}

/** Whether a value is one sum of usage: five finite numbers, which is what the screens draw. */
function isCost(value: unknown): value is NonNullable<SessionState["cost"]> {
	if (!isObject(value)) return false;
	return (
		typeof value.input === "number" &&
		Number.isFinite(value.input) &&
		typeof value.output === "number" &&
		Number.isFinite(value.output) &&
		typeof value.cacheRead === "number" &&
		Number.isFinite(value.cacheRead) &&
		typeof value.cacheWrite === "number" &&
		Number.isFinite(value.cacheWrite) &&
		typeof value.total === "number" &&
		Number.isFinite(value.total)
	);
}

function isQueuedMessage(value: unknown): value is QueuedMessage {
	return (
		isObject(value) &&
		typeof value.id === "string" &&
		typeof value.text === "string" &&
		typeof value.when === "number"
	);
}
