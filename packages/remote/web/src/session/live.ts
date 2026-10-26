// The pickers read the folded state, not the opening, which may be older.

import type { PermissionMode, SessionState } from "@adeildo/pi-remote-protocol";
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";

/** The three values the pickers start on, read from the live state with no fallback to the opening. */
export interface Live {
	mode?: PermissionMode;
	model?: SessionState["model"];
	thinking?: string;
}

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
