import { BOARD, boardView, MODE_SET, PEERS, totalsOf, type EventScope } from "@adeildo/pi-kit";
import { applyChange, type SessionState } from "@adeildo/pi-remote-protocol";
// The state fields that come from the process rather than the log, each placed by its producer.
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

/** What a producer may read: the scope's contracts, the branch's entries and pi's own context. */
interface ProducerInput {
	scope: EventScope;
	entries: readonly SessionEntry[];
	ctx: ExtensionContext;
}

/** Shared by the opening and `cost.changed`, so the two numbers cannot disagree. */
export function costOf(entries: readonly SessionEntry[]): SessionState["cost"] {
	const totals = totalsOf(entries);
	return {
		input: totals.input,
		output: totals.output,
		cacheRead: totals.cacheRead,
		cacheWrite: totals.cacheWrite,
		// The kit names the money `cost`; the wire has called it `total` since the field existed.
		total: totals.cost,
	};
}

/** One field of the state, and how to put its value on a state that came from the log. */
export interface Producer {
	/** The field of the state this producer owns, which is what a test names it by. */
	field: keyof SessionState;
	/** The state with this field set, or the state it was given when the value is not known. */
	apply(state: SessionState, input: ProducerInput): SessionState;
	/** The state change that publishes it when it moves on its own, for a field that changes mid-session. */
	change?: string;
}

/** A producer that does not know its value returns the state untouched. */
export const PRODUCERS: readonly Producer[] = [
	{
		field: "theme",
		// What the session wears: the accent of the theme it runs under, and the color the room gave it.
		// The room is the only one that knows the color, and it names the session it is for.
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
		// The board the session keeps, cut and ordered by the feature that wrote it: this carries it and
		// decides nothing, so a screen draws the writer's order and never one of its own.
		apply: (state, { scope }) => {
			const board = BOARD.current(scope);
			return board === undefined ? state : { ...state, board: boardView(board) };
		},
	},
	{
		field: "cost",
		// What the session has spent so far, summed from pi's own per-message usage. Read from the branch
		// rather than folded from events, so the opening always carries it and a reconnect keeps it.
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
