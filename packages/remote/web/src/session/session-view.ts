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

/**
 * The transcript and the state, worked out again only when what they come from changed. A client
 * changes its session in place: an entry or a state change is pushed onto its list, a snapshot swaps the
 * list, and a `/tree` move changes the leaf. So the lists, their lengths and the leaf say whether
 * anything moved, and a screen that draws on every envelope does not fold the whole log each time.
 * An entry changed where it stands would go unseen: the client never does that today, and one that
 * starts to has to swap the list or bump what this compares.
 */
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
	const snapshot = session.summary;
	return snapshot?.name ?? snapshot?.handle ?? `new-${session.key.session.slice(-4)}`;
}

/**
 * What the header says about the session beside its name: the machine, what it is doing and the model it
 * answers with. It is text, and typed as text on purpose: this array goes to a `join`, and an
 * `unknown[]` let the folded state object through to become `[object Object]` without a word from the
 * compiler. The status is the field for "what it is doing"; the folded `state` is the whole picture.
 */
export function aboutOf(session: ClientSession): string[] {
	const { state } = session;
	return [session.key.machine, state.status, state.model?.id].filter(
		(part): part is string => part !== undefined,
	);
}

/**
 * Where a user message was typed, when the bridge could say. Every user message is the operator's, since
 * the clients are devices they signed in, so the screen says "you" on all of them and this adds the
 * device beside it. No origin does not mean the terminal: the bridge says nothing when it is not sure
 * (two prompts with the same words, a slash prompt pi expanded), and the screen then says only "you".
 * The name is the client's own, so it is read as text.
 */
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
