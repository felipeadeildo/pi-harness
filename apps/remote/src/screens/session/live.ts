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
 * Everything the composer takes from the session. It is built from the state in `composerOf` and nowhere
 * else, and the composer takes it whole: a screen that names `mode` by hand is a screen that can name the
 * snapshot's `mode` again, and no test would notice because it would still draw.
 */
export interface ComposerView extends Live {
	/** What the session holds for the agent to finish, which every client sees the same way. */
	waiting: ClientSession["state"]["queue"];
	/** What a phone may run by typing `/`, as the session last said. */
	commands: ClientSession["state"]["commands"];
	/** Whether the session takes `mode.set`; absent until it says. */
	serves: boolean | undefined;
	/** Whether a run is going, which is when Abort and Steer mean something. */
	running: boolean;
	/** The models the session could switch to; absent until the bridge says. */
	models: ClientSession["state"]["models"];
	/** How many models the registry listed, when `models` holds fewer. */
	modelsTotal: ClientSession["state"]["modelsTotal"];
}

export function composerOf(session: ClientSession): ComposerView {
	return {
		...liveOf(session),
		waiting: session.state.queue,
		commands: session.state.commands,
		serves: session.state.permissions.serves,
		running: runningOf(session.state.status),
		models: session.state.models,
		modelsTotal: session.state.modelsTotal,
	};
}

/** A run is going while the session works or waits on a person: both can be aborted. */
export function runningOf(status: SessionState["status"]): boolean {
	return status === "working" || status === "blocked";
}

export function liveOf(session: ClientSession): Live {
	const { state } = session;
	return {
		mode: state.permissions.mode,
		model: state.model,
		thinking: state.thinkingLevel,
	};
}
