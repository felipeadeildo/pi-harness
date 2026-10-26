// The state fields that come from the process rather than the log, each placed by its producer.
import {
	BOARD,
	type Board,
	boardView,
	type EventScope,
	MODE_SET,
	PEERS,
	totalsOf,
} from "@adeildo/pi-kit";
import { applyChange, type BoardView, type SessionState } from "@adeildo/pi-remote-protocol";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

interface ProducerInput {
	scope: EventScope;
	entries: readonly SessionEntry[];
	ctx: ExtensionContext;
}

/** The terminal's view, with room for more: the first backlog cards and the last deliveries. */
export function remoteBoard(board: Board): BoardView {
	const cards = board.cards;
	return {
		...boardView(board),
		waiting: cards.filter((card) => card.column === "backlog").slice(0, WAITING),
		done: cards.filter((card) => card.column === "done").slice(-DELIVERED),
	};
}

const WAITING = 10;
const DELIVERED = 10;

/** Shared by the opening and `cost.changed`, so the two numbers cannot disagree. */
export function costOf(entries: readonly SessionEntry[]): SessionState["cost"] {
	const totals = totalsOf(entries);
	return {
		input: totals.input,
		output: totals.output,
		cacheRead: totals.cacheRead,
		cacheWrite: totals.cacheWrite,
		total: totals.cost,
	};
}

export interface Producer {
	field: keyof SessionState;
	apply(state: SessionState, input: ProducerInput): SessionState;
	/** For a field that changes mid-session. */
	change?: string;
}

/** A producer that does not know its value returns the state untouched. */
export const PRODUCERS: readonly Producer[] = [
	{
		field: "theme",
		// The room is the only one that knows the color.
		apply: (state, { scope }) => {
			const color = PEERS.current(scope)?.me?.color;
			return {
				...state,
				theme: { accent: "accent", ...(color === undefined ? {} : { color }) },
			};
		},
	},
	{
		field: "board",
		// Cut and ordered by the board feature; screens draw that order.
		apply: (state, { scope }) => {
			const board = BOARD.current(scope);
			return board === undefined ? state : { ...state, board: remoteBoard(board) };
		},
	},
	{
		field: "cost",
		// Read from the branch, so every opening carries it.
		apply: (state, { entries }) => ({ ...state, cost: costOf(entries) }),
	},
	{
		field: "permissions",
		// Whether the session takes a mode at all; the mode itself comes from the log.
		apply: (state, { scope }) => ({
			...state,
			permissions: { ...state.permissions, serves: MODE_SET.current(scope) !== undefined },
		}),
	},
	{
		field: "models",
		// Read when an opening is built: pi gives no signal when the registry changes. No registry
		// leaves the field absent, which is not the same as no models.
		apply: (state, { ctx }) => {
			const registry = ctx.modelRegistry as Partial<ExtensionContext["modelRegistry"]> | undefined;
			if (typeof registry?.getAvailable !== "function") return state;
			const models = registry
				.getAvailable()
				.map(({ provider, id, name }) => ({ provider, id, name }));
			return applyChange(state, "models.listed", { models });
		},
	},
	{
		field: "model",
		// Also on `session.live`, but the opening replaces what came before it.
		apply: (state, { ctx }) => ({
			...state,
			...(ctx.model === undefined
				? {}
				: { model: { provider: ctx.model.provider, id: ctx.model.id } }),
			...(ctx.thinkingLevel === undefined ? {} : { thinkingLevel: ctx.thinkingLevel }),
		}),
	},
];
