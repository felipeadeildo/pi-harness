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

	saw(type: string, data: unknown): void {
		if (isStateChangeType(type)) this.#state = applyChange(this.#state, type, data);
	}

	get openQuestions(): string[] {
		return openQuestions(this.#state).map((ask) => ask.id);
	}

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
