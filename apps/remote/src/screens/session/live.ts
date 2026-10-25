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

export function liveOf(session: ClientSession): Live {
	const { state } = session;
	return {
		mode: state.permissions.mode,
		model: state.model,
		thinking: state.thinkingLevel,
	};
}
