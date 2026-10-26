// What a session screen derives from a session: the cached view, the title and the about line.
import type { SessionState, TranscriptItem } from "@adeildo/pi-remote-protocol";
import {
	type ClientSession,
	harnessOf,
	transcriptOfSession,
} from "@adeildo/pi-remote-protocol/client";

import { plain } from "./plain.ts";

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

/** What the session is called: the name pi has for it, else the handle a room uses. */
export function titleOf(session: ClientSession): string {
	const summary = session.summary;
	return summary?.name ?? summary?.handle ?? `new-${session.key.session.slice(-4)}`;
}

export function aboutOf(session: ClientSession): string[] {
	const { state, summary } = session;
	const folder = summary?.cwd.split("/").findLast((part) => part !== "");
	return [folder, session.key.machine, state.status, state.model?.id].filter(
		(part): part is string => part !== undefined,
	);
}

/** The device a user message came from. Absent does not mean the terminal: the bridge says nothing when unsure. */
export function originOf(
	promptFrom: SessionState["promptFrom"],
	entry: string,
): string | undefined {
	const by = promptFrom?.[entry];
	if (by === undefined) return undefined;
	// A sender with no name is still known to be a client, and the line does not invent one.
	const name = plain(by.name).trim();
	return name === "" ? "from a client" : `from ${name}`;
}
