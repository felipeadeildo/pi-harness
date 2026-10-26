// The pickers read the folded state, not the opening, which may be older.

import type { PermissionMode, SessionState } from "@adeildo/pi-remote-protocol";
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";

export interface Live {
	mode?: PermissionMode;
	model?: SessionState["model"];
	thinking?: string;
}

export interface ComposerView extends Live {
	waiting: ClientSession["state"]["queue"];
	commands: ClientSession["state"]["commands"];
	/** Absent until the session says. */
	serves: boolean | undefined;
	running: boolean;
	models: ClientSession["state"]["models"];
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
