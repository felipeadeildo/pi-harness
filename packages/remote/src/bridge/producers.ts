// The fields of a session's state that come from the process rather than from the log: a capability, the
// money spent, who sent a prompt. Each one owns its field and knows how to place it, and the opening
// reads them from here instead of naming each in the bridge.
import { MODE_SET, type EventScope } from "@adeildo/pi-kit";
import type { SessionState } from "@adeildo/pi-remote-protocol";

/** One field of the state, and how to put its value on a state that came from the log. */
export interface Producer {
	/** The state with this field set, or the state it was given when the value is not known. */
	apply(state: SessionState, scope: EventScope): SessionState;
	/** The state change that publishes it when it moves on its own, for a field that changes mid-session. */
	change?: string;
}

/**
 * What the bridge reads from pi. Adding a field means adding an entry here; absent stays absent, because
 * a producer that does not know a value returns the state untouched.
 */
export const PRODUCERS: readonly Producer[] = [
	{
		// Whether the session takes a mode at all. A capability, not a value: the mode itself comes from
		// the log, and this says only whether there is a dial to turn.
		apply: (state, scope) =>
			MODE_SET.current(scope) === undefined
				? state
				: { ...state, permissions: { ...state.permissions, serves: true } },
	},
];
