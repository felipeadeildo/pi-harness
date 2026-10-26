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

/**
 * What a session carries besides its conversation. Written by the harness and read by every reader
 * through one reducer.
 */
export interface SessionState {
	questions: Record<string, Ask>;
	/** What the permission gate decided, and in which mode it ran. */
	permissions: {
		rulings: Record<string, { ruling: CallRuling; by?: By }>;
		mode?: PermissionMode;
		/**
		 * Whether this session takes `mode.set`, which a client needs before it offers a dial. Absent
		 * until a bridge said, because "not said yet" is not "cannot".
		 */
		serves?: boolean;
	};
	/** The last rename, for a mention of the older handle. */
	renamed?: { from: string; to: string; by?: By };
	/** What the session's board holds. Absent when no feature provides one, which is not an empty board. */
	board?: BoardView;
	/**
	 * What the session wears on a screen: the theme's accent, and the color the room gave it. The wire
	 * carries the names, so a client resolves them in a palette of its own.
	 */
	theme?: { accent: string; color?: string };
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
	/** Who sent the prompts that came from a client, by entry id: the transcript says where they came from. */
	promptFrom?: Record<string, By>;
	/**
	 * The models the session could switch to. Absent until a bridge said, because "not said yet" is not
	 * "none": a picker that finds the list absent waits, and one that finds it empty says so.
	 */
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

/**
 * Adds one state change to the state. One the shape check refuses is skipped, not thrown: a log written
 * by a newer harness must not stop a client from drawing the rest.
 */
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
