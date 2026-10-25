// What the composer's pickers show: the session as it is now, not as the snapshot found it. The snapshot
// is a photograph taken when a client arrived; the state is folded from every event since, so a mode the
// person changed a second ago is there and the photograph still says the old one.

import type { ClientSession } from "@adeildo/pi-remote-client";
import type { PermissionMode, SessionState } from "@adeildo/pi-remote-protocol";

/** The three values the pickers start on, read from the live state with no fallback to the snapshot. */
export interface Live {
	mode?: PermissionMode;
	model?: SessionState["model"];
	thinking?: string;
}

/**
 * Everything the composer takes from the session, in one place. The route spreads this instead of
 * naming each field: a route that names `mode` by hand is a route that can name the snapshot's `mode`
 * again, and no test would notice because the screen would still draw.
 */
export function composerOf(session: ClientSession): Live & {
	waiting: ClientSession["state"]["queue"];
	commands: ClientSession["state"]["commands"];
	serves: boolean | undefined;
} {
	return {
		...liveOf(session),
		waiting: session.state.queue,
		commands: session.state.commands,
		serves: session.state.permissions.serves,
	};
}

export function liveOf(session: ClientSession): Live {
	const { state } = session;
	return {
		mode: state.permissions.mode,
		model: state.model,
		thinking: state.thinkingLevel,
	};
}
