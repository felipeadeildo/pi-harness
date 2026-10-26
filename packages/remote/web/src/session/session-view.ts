import type { SessionState, TranscriptItem } from "@adeildo/pi-remote-protocol";
import {
	type ClientSession,
	type ListedSession,
	harnessOf,
	transcriptOfSession,
} from "@adeildo/pi-remote-protocol/client";

import { plain } from "./plain.ts";
import { nameOf } from "./rows.ts";

export interface View {
	state: SessionState;
	items: TranscriptItem[];
}

const views = new WeakMap<ClientSession, { key: readonly unknown[]; view: View }>();

/** Recomputed only when the entry lists, their lengths or the leaf change. */
export function viewOf(session: ClientSession): View {
	const key = [
		session.entries,
		session.entries.length,
		session.leaf,
		session.state,
		Object.keys(session.state.questions).length +
			Object.keys(session.state.permissions.rulings).length,
	];
	const held = views.get(session);
	if (held !== undefined && held.key.every((part, at) => part === key[at])) return held.view;
	const view = { state: harnessOf(session), items: transcriptOfSession(session).items };
	views.set(session, { key, view });
	return view;
}

/** Pi's name for it, else the room's handle; the list's row stands in until the opening arrives. */
export function titleOf(session: ClientSession, listed?: ListedSession): string {
	const summary = session.summary;
	return (
		session.state.name ??
		summary?.name ??
		summary?.handle ??
		(listed === undefined ? undefined : nameOf(listed)) ??
		`new-${session.key.session.slice(-4)}`
	);
}

/** The folded state's word, else the opening's: the same rule the list follows. */
export function statusOf(session: ClientSession, listed?: ListedSession): SessionState["status"] {
	return (
		session.state.status ??
		session.summary?.status ??
		listed?.state.status ??
		listed?.summary?.status
	);
}

/** The device a user message came from. Absent does not mean the terminal: the bridge says nothing when unsure. */
export function originOf(
	promptFrom: SessionState["promptFrom"],
	entry: string,
): string | undefined {
	const by = promptFrom?.[entry];
	if (by === undefined) return undefined;
	// A sender with no name is still a client, and the line invents none.
	const name = plain(by.name).trim();
	return name === "" ? "from a client" : `from ${name}`;
}
