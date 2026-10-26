// The session's harness state as this bridge knows it: what the kit logs for this session, folded the
// same way every reader folds it, so the opening it sends needs no replay behind it.
import {
	applyChange,
	isStateChangeType,
	emptySessionState,
	openQuestions,
	type PermissionMode,
	type SessionState,
} from "@adeildo/pi-remote-protocol";

// The log's `session.state` is peers' running or idle and never crosses; the wire's
// `session.status` is pi's, written by the bridge.
const FORWARDED: ReadonlySet<string> = new Set([
	"ask.opened",
	"ask.closed",
	"call.ruled",
	"mode.changed",
	"prompt.received",
]);

export interface Logged {
	session: string;
	type: string;
	data: unknown;
}

/** Forwards only this session's events, and only the types in `FORWARDED`. */
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
	#state: SessionState = emptySessionState();

	/** Folds one event the session logged into the state an opening carries. */
	saw(type: string, data: unknown): void {
		// The forwarder hands whatever the log wrote; only a state change has an effect to fold.
		if (isStateChangeType(type)) this.#state = applyChange(this.#state, type, data);
	}

	get openQuestions(): string[] {
		return openQuestions(this.#state).map((ask) => ask.id);
	}

	/** The state as it stands, with what pi knows and the log does not. */
	state(mode: unknown): SessionState {
		return {
			...this.#state,
			permissions: {
				...this.#state.permissions,
				...(mode === undefined ? {} : { mode: mode as PermissionMode }),
			},
		};
	}
}
