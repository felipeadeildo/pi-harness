// Folded by the same function on the daemon and every client.

import type { BoardView } from "../board-view.ts";
import { type By, isObject } from "../by.ts";
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
	/** A judge or an expiry answers for nobody. */
	by?: By;
	result: AskResult;
	closed: true;
}

export type Ask = OpenAsk | ClosedAsk;

export interface SessionState {
	questions: Record<string, Ask>;
	permissions: {
		rulings: Record<string, { ruling: CallRuling; by?: By }>;
		mode?: PermissionMode;
		/** Absent until a bridge said: "not said yet" is not "cannot". */
		serves?: boolean;
	};
	/** Absent when no feature provides one, which is not an empty board. */
	board?: BoardView;
	/** Theme color names; a client resolves them in its own palette. */
	theme?: { accent: string; color?: string };
	/** In delivery order. */
	queue: QueuedMessage[];
	status?: (typeof SESSION_STATES)[number];
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	name?: string;
	/** The host's list, so the field and the refusal cannot disagree. */
	commands?: SessionCommand[];
	/** By entry id. */
	promptFrom?: Record<string, By>;
	/** Absent until a bridge said: a picker waits on absent and says so on empty. */
	models?: ModelOption[];
	/** More than `models` holds when the list was cut. */
	modelsTotal?: number;
	/** While a dialog no client can answer is open. */
	prompt?: { kind: PromptKind; title?: string };
	cost?: SessionCost;
	activity?: SessionActivity;
	/** Absent outside a git repository. */
	branch?: string;
	/** The first line of the agent's last answer. */
	said?: { text: string; at: number };
}

export const ACTIVITIES = ["thinking", "writing", "tool", "compacting", "resting"] as const;

/** What the agent does right now, and since when (the writer's clock). */
export interface SessionActivity {
	what: (typeof ACTIVITIES)[number];
	tool?: string;
	/** The tool's subject: a command, a path, a pattern. */
	about?: string;
	since: number;
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
		if (isStateChangeType(event.type)) state = applyChange(state, event.type, event.data);
	}
	return state;
}

/** Pi's own changes of model, thinking level and name, in pi's JSON-mode shapes. */
export function applyPi(state: SessionState, type: string, data: unknown): SessionState {
	if (!isObject(data)) return state;
	if (type === "pi.model_select" && isObject(data.model)) {
		const { provider, id } = data.model;
		return typeof provider === "string" && typeof id === "string"
			? { ...state, model: { provider, id } }
			: state;
	}
	if (type === "pi.thinking_level_select" && typeof data.level === "string")
		return { ...state, thinkingLevel: data.level };
	if (type === "pi.session_info_changed") {
		const { name: _old, ...rest } = state;
		return typeof data.name === "string" ? { ...rest, name: data.name } : rest;
	}
	return state;
}
