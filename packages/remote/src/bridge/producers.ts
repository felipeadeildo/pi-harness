import { BOARD, boardView, MODE_SET, totalsOf, type EventScope } from "@adeildo/pi-kit";
import { applyChange, type SessionState } from "@adeildo/pi-remote-protocol";
// The fields of a session's state that come from the process rather than from the log: a capability, the
// money spent, who sent a prompt. Each one owns its field and knows how to place it, and the opening
// reads them from here instead of naming each in the bridge.
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

/** One field of the state, and how to put its value on a state that came from the log. */
export interface Producer {
	/** The state with this field set, or the state it was given when the value is not known. */
	apply(
		state: SessionState,
		scope: EventScope,
		entries: readonly SessionEntry[],
		ctx: ExtensionContext,
	): SessionState;
	/** The state change that publishes it when it moves on its own, for a field that changes mid-session. */
	change?: string;
}

/**
 * What the bridge reads from pi. Adding a field means adding an entry here; absent stays absent, because
 * a producer that does not know a value returns the state untouched.
 *
 * This list is the reads. `promptFrom` is not one: it is a fold the bridge keeps as prompts and entries
 * arrive, so it stays in `bridge.ts` until a second fold exists to share the shape with.
 */
export const PRODUCERS: readonly Producer[] = [
	{
		// The board the session keeps, cut and ordered by the feature that wrote it: this carries it and
		// decides nothing, so a screen draws the writer's order and never one of its own.
		apply: (state, scope) => {
			const board = BOARD.current(scope);
			return board === undefined ? state : { ...state, board: boardView(board) };
		},
	},
	{
		// What the session has spent so far, summed from pi's own per-message usage. Read from the branch
		// rather than folded from events, so the opening always carries it and a reconnect keeps it.
		apply: (state, _scope, entries) => {
			const totals = totalsOf(entries);
			return {
				...state,
				cost: {
					input: totals.input,
					output: totals.output,
					cacheRead: totals.cacheRead,
					cacheWrite: totals.cacheWrite,
					// The kit names the money `cost`; the wire has called it `total` since the field existed.
					total: totals.cost,
				},
			};
		},
	},
	{
		// Whether the session takes a mode at all. A capability, not a value: the mode itself comes from
		// the log, and this says only whether there is a dial to turn. A live bridge always knows, so it
		// answers both ways; only the empty state before any bridge spoke has no opinion.
		apply: (state, scope) => ({
			...state,
			permissions: { ...state.permissions, serves: MODE_SET.current(scope) !== undefined },
		}),
	},
	{
		// The models pi could switch to, read from the registry the terminal's `/model` lists. pi gives no
		// signal when it changes, so this is read when a snapshot is built. A host with no registry has not
		// said which models exist, which is not the same as none, so the field stays absent.
		apply: (state, _scope, _entries, ctx) => {
			const registry = ctx.modelRegistry as Partial<ExtensionContext["modelRegistry"]> | undefined;
			if (typeof registry?.getAvailable !== "function") return state;
			const models = registry
				.getAvailable()
				.map(({ provider, id, name }) => ({ provider, id, name }));
			return applyChange(state, "models.listed", { models });
		},
	},
];
