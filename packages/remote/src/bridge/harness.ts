// The session's harness state as this bridge knows it: what the kit logs for this session, folded the
// same way every reader folds it, so the snapshot it sends needs no replay behind it.
import {
	applyLogged,
	emptyHarnessState,
	type HarnessState,
	openAsks,
} from "@adeildo/pi-remote-protocol";

/**
 * The log's facts a client reduces. The bridge sends the session's own facts itself, and the log's
 * `session.state` is peers' running or idle, not pi's program status, so it never crosses.
 */
export const LOGGED_FACTS: ReadonlySet<string> = new Set([
	"tasks.changed",
	"ask.opened",
	"ask.closed",
	"call.ruled",
	"mode.changed",
	"prompt.received",
	"session.renamed",
]);

export interface Fact {
	type: string;
	data: unknown;
}

export class Harness {
	/**
	 * The state as the log has written it so far. It is the same shape a client reduces and the same
	 * shape the daemon seeds itself with, so there is one reducer and one bound, here and everywhere.
	 */
	#state: HarnessState = emptyHarnessState();

	/** Folds one event the session logged into the state a snapshot carries. */
	saw(type: string, data: unknown): void {
		this.#state = applyLogged(this.#state, type, data);
	}

	get openAsks(): string[] {
		return openAsks(this.#state).map((ask) => ask.id);
	}

	/** The state as it stands, with the two things pi knows and the log does not. */
	snapshot(tasks: unknown, mode: unknown): HarnessState {
		return {
			...this.#state,
			...(tasks === undefined ? {} : { tasks: tasks as HarnessState["tasks"] }),
			...(mode === undefined ? {} : { mode: mode as HarnessState["mode"] }),
		};
	}
}
