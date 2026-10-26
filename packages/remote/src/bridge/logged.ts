// The session's harness state as this bridge knows it: what the kit logs for this session, folded the
// same way every reader folds it, so the snapshot it sends needs no replay behind it.
import {
	applyChange,
	isStateChangeType,
	emptySessionState,
	openQuestions,
	type PermissionMode,
	type SessionState,
} from "@adeildo/pi-remote-protocol";

/**
 * The log's state changes a client reduces. The log's own `session.state` is peers' running or idle, a
 * `RoomActivity` from another package, and it never crosses: the wire's `session.status` is pi's
 * program status, written by the bridge.
 */
const FORWARDED: ReadonlySet<string> = new Set([
	"tasks.changed",
	"ask.opened",
	"ask.closed",
	"call.ruled",
	"mode.changed",
	"prompt.received",
	"session.renamed",
]);

export interface Logged {
	session: string;
	type: string;
	data: unknown;
}

/**
 * Forwards a state change the kit logged for this session, and keeps what a snapshot needs of it. Only this
 * session's events cross, and only the ones in `FORWARDED`: the log carries state changes of other sessions
 * and types that are peers' business, and both would be wrong on the wire.
 */
export function forward(
	logged: Logged,
	session: string,
	changes: Harness,
	send: (type: string, data: unknown) => void,
): void {
	if (logged.session !== session || !FORWARDED.has(logged.type)) return;
	changes.saw(logged.type, logged.data);
	send(logged.type, logged.data);
}

export class Harness {
	/**
	 * The state as the log has written it so far. It is the same shape a client reduces and the same
	 * shape the daemon seeds itself with, so there is one reducer and one bound, here and everywhere.
	 */
	#state: SessionState = emptySessionState();

	/** Folds one event the session logged into the state a snapshot carries. */
	saw(type: string, data: unknown): void {
		// The forwarder hands whatever the log wrote; only a state change has an effect to fold.
		if (isStateChangeType(type)) this.#state = applyChange(this.#state, type, data);
	}

	get openQuestions(): string[] {
		return openQuestions(this.#state).map((ask) => ask.id);
	}

	/** The state as it stands, with what pi knows and the log does not. */
	snapshot(tasks: unknown, mode: unknown): SessionState {
		return {
			...this.#state,
			...(tasks === undefined ? {} : { tasks: tasks as SessionState["tasks"] }),
			permissions: {
				...this.#state.permissions,
				...(mode === undefined ? {} : { mode: mode as PermissionMode }),
			},
		};
	}
}
