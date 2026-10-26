// One entry per state change: its shape, its wire check and its fold. `StateChangeMap` is read from
// this table, so an entry without both a check and a fold does not compile.

import { type By, isBy, isObject } from "../by.ts";
import {
	type AskQuestion,
	type AskResult,
	type CallRuling,
	type ModelOption,
	type PermissionMode,
	PROMPT_KINDS,
	type PromptKind,
	type SessionCommand,
	SESSION_STATES,
} from "../state-changes.ts";
import { type QueuedMessage } from "../summary.ts";
import { ACTIVITIES, type SessionActivity, type SessionCost, type SessionState } from "./state.ts";

export interface Entry<T> {
	check(data: unknown): data is T;
	apply(state: SessionState, data: T): SessionState;
}

function entry<T>(written: Entry<T>): Entry<T> {
	return written;
}

const unchanged = (state: SessionState): SessionState => state;

/** The daemon holds the state for the session's life, so answered questions must not pile up. */
export const KEPT_CLOSED = 100;

/** A registry is a third party's data. */
const KEPT_MODELS = 300;

const KEPT_PROMPTS = 100;

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

export const CHANGES = {
	"call.ruled": entry({
		check: (data): data is { toolCallId: string; ruling: CallRuling; by?: By } =>
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
						// A call ruled again moves to the end, which is also the order the bound drops from.
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
	}),
	"ask.opened": entry({
		check: (
			data,
		): data is { id: string; source: string; questions: AskQuestion[]; expiresAt?: number } =>
			isObject(data) && typeof data.id === "string" && Array.isArray(data.questions),
		apply: (state, data) => ({
			...state,
			questions: { ...state.questions, [data.id]: data },
		}),
	}),
	"ask.closed": entry({
		check: (data): data is { id: string; by?: By; result: AskResult } =>
			isObject(data) && typeof data.id === "string" && isObject(data.result),
		apply: (state, data) => {
			const before = state.questions[data.id];
			// Only a named second answer replaces who gave the first.
			const earlier = before?.closed === true ? before.by : undefined;
			const by = data.by !== undefined ? data.by : earlier;
			return bound({
				...state,
				questions: {
					...state.questions,
					[data.id]: {
						id: data.id,
						result: data.result,
						closed: true,
						...(by === undefined ? {} : { by }),
					},
				},
			});
		},
	}),
	"mode.changed": entry({
		check: (data): data is { mode: PermissionMode } =>
			isObject(data) &&
			(data.mode === "manual" ||
				data.mode === "edits" ||
				data.mode === "judge" ||
				data.mode === "full"),
		apply: (state, data) => ({
			...state,
			permissions: { ...state.permissions, mode: data.mode },
		}),
	}),
	"session.status": entry({
		// Pi's status words only: the log's `session.state` is peers' running or idle.
		check: (data): data is { status: (typeof SESSION_STATES)[number] } =>
			isObject(data) && SESSION_STATES.some((status) => status === data.status),
		apply: (state, data) => ({ ...state, status: data.status }),
	}),
	"session.live": entry({
		// A `source` this version does not know would be drawn by the screen and misjudged by the wire.
		check: (
			data,
		): data is {
			pid?: number;
			startedAt?: number;
			cwd?: string;
			name?: string;
			kind: "terminal" | "background";
			model?: { provider: string; id: string };
			thinkingLevel?: string;
			/** Pi writes the file only at the first message, so `ENOENT` means no older entries yet. Absent with `--no-session`. */
			file?: string;
			commands?: SessionCommand[];
		} =>
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
			// Absent means unchanged.
			...(data.name === undefined ? {} : { name: data.name }),
			...(data.model === undefined ? {} : { model: data.model }),
			...(data.thinkingLevel === undefined ? {} : { thinkingLevel: data.thinkingLevel }),
			...(data.commands === undefined ? {} : { commands: data.commands }),
		}),
	}),
	"session.gone": entry({
		check: (data): data is { reason: "exit" | "crash" | "unanswered" | "replaced" } =>
			isObject(data) &&
			(data.reason === "exit" ||
				data.reason === "crash" ||
				data.reason === "unanswered" ||
				data.reason === "replaced"),
		apply: unchanged,
	}),
	// From 1 in each epoch; `pi.message_start` carries the same number.
	"stream.bound": entry({
		check: (data): data is { messages: { stream: number; entry: string }[] } =>
			isObject(data) &&
			Array.isArray(data.messages) &&
			data.messages.every(
				(message: unknown) =>
					isObject(message) &&
					typeof message.stream === "number" &&
					typeof message.entry === "string",
			),
		apply: unchanged,
	}),
	// Null when a `/tree` move goes back to the root.
	"leaf.changed": entry({
		check: (data): data is { leaf: string | null } =>
			isObject(data) && (data.leaf === null || typeof data.leaf === "string"),
		// The entries carry the leaf.
		apply: unchanged,
	}),
	// Read leniently; see `isStateChange`.
	"prompt.received": entry({
		check: (data): data is { by: By } => isObject(data) && isBy(data.by),
		apply: unchanged,
	}),
	/** Written only when the bridge is sure; a prompt typed at the terminal has none. */
	"prompt.from": entry({
		check: (data): data is { entry: string; by: By } =>
			isObject(data) && typeof data.entry === "string" && isBy(data.by),
		apply: (state, data) => ({
			...state,
			promptFrom: Object.fromEntries(
				Object.entries({ ...state.promptFrom, [data.entry]: data.by }).slice(-KEPT_PROMPTS),
			),
		}),
	}),
	"models.listed": entry({
		// One unreadable entry makes the whole list unreadable.
		check: (data): data is { models: ModelOption[] } =>
			isObject(data) &&
			Array.isArray(data.models) &&
			data.models.every(
				(model) =>
					isObject(model) &&
					typeof model.provider === "string" &&
					model.provider !== "" &&
					typeof model.id === "string" &&
					model.id !== "" &&
					typeof model.name === "string" &&
					model.name !== "",
			),
		apply: (state, data) => ({
			...state,
			models: data.models.slice(0, KEPT_MODELS),
			modelsTotal: data.models.length,
		}),
	}),
	// Every client sees the same list.
	"queue.changed": entry({
		check: (data): data is { queue: QueuedMessage[] } =>
			isObject(data) && Array.isArray(data.queue) && data.queue.every(isQueuedMessage),
		apply: (state, data) => ({ ...state, queue: data.queue }),
	}),
	"terminal.prompted": entry({
		check: (data): data is { open: boolean; kind: PromptKind; title?: string } =>
			isObject(data) &&
			typeof data.open === "boolean" &&
			PROMPT_KINDS.some((kind) => kind === data.kind) &&
			(data.title === undefined || typeof data.title === "string"),
		apply: (state, data) => {
			const { prompt: _closed, ...rest } = state;
			return data.open ? { ...rest, prompt: { kind: data.kind, title: data.title } } : rest;
		},
	}),
	"cost.changed": entry({
		// A `NaN` would be drawn as `$NaN`.
		check: (data): data is { cost: SessionCost } => isObject(data) && isCost(data.cost),
		apply: (state, data) => ({ ...state, cost: data.cost }),
	}),
	"activity.changed": entry({
		check: (data): data is { activity: SessionActivity } =>
			isObject(data) && isActivity(data.activity),
		apply: (state, data) => ({ ...state, activity: data.activity }),
	}),
	"branch.changed": entry({
		check: (data): data is { branch?: string } =>
			isObject(data) && (data.branch === undefined || typeof data.branch === "string"),
		apply: (state, data) => {
			const { branch: _old, ...rest } = state;
			return data.branch === undefined ? rest : { ...rest, branch: data.branch };
		},
	}),
	"said.changed": entry({
		check: (data): data is { said: { text: string; at: number } } =>
			isObject(data) &&
			isObject(data.said) &&
			typeof data.said.text === "string" &&
			typeof data.said.at === "number",
		apply: (state, data) => ({ ...state, said: data.said }),
	}),
};

export type StateChangeMap = { [K in keyof typeof CHANGES]: DataOf<(typeof CHANGES)[K]> };

export type StateChangeType = keyof StateChangeMap;

type DataOf<E> = E extends Entry<infer T> ? T : never;

export const STATE_CHANGES: readonly StateChangeType[] = Object.keys(CHANGES) as StateChangeType[];

export function isStateChangeType(type: string): type is StateChangeType {
	return Object.hasOwn(CHANGES, type);
}

const BY_TYPE: { [K in StateChangeType]: Entry<StateChangeMap[K]> } = CHANGES;

export function applyOne<K extends StateChangeType>(
	state: SessionState,
	type: K,
	data: unknown,
): SessionState {
	const entry = BY_TYPE[type];
	return entry.check(data) ? entry.apply(state, data) : state;
}

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

function isActivity(value: unknown): value is SessionActivity {
	return (
		isObject(value) &&
		(ACTIVITIES as readonly unknown[]).includes(value.what) &&
		typeof value.since === "number" &&
		(value.tool === undefined || typeof value.tool === "string") &&
		(value.about === undefined || typeof value.about === "string")
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
