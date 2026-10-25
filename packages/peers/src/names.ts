// What a session is called and painted with. Both come from the folder's logs, so every session
// shows the same name in the same color, and a name stays put while it is open.
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

import type { Peer } from "./folder.ts";

/**
 * Theme colors with distinct hues in dark and light themes alike. The footer already spends amber on
 * warning, green on success, red on error and purple on accent, so a peer never wears those. With more
 * than four sessions in one folder two share a color, and the name is what tells them apart.
 */
export const PEER_COLORS = [
	"syntaxKeyword",
	"syntaxString",
	"syntaxVariable",
	"syntaxType",
] as const;

type PeerColor = (typeof PEER_COLORS)[number];

export interface Named {
	session: string;
	handle: string;
	/** What this session wears. Any theme color can arrive from the logs; the palette above is what
	 * a new session is given. */
	color: ThemeColor;
}

/**
 * The words the room uses: the open sessions by session id, and the words they used to have.
 * The two travel together, because "a live word wins" is a rule about both.
 */
export interface Names {
	readonly bySession: ReadonlyMap<string, Named>;
	readonly aliases: ReadonlyMap<string, string>;
}

/**
 * Names for the open sessions, oldest first. A name two sessions share gets a number on the
 * newer one, and a session not titled yet is `new` and the end of its id.
 */
export function namesOf(live: readonly Peer[]): Names {
	const names = new Map<string, Named>();
	const aliases = new Map<string, string>();
	const taken = new Set<string>();
	const used = new Set<PeerColor>();
	for (const peer of live) {
		// A word a session used to have points here, unless a live session holds it now.
		for (const alias of peer.aliases ?? [])
			if (!live.some((other) => other !== peer && other.handle === alias)) {
				taken.add(alias);
				aliases.set(alias, peer.session);
			}
		const base = peer.handle ?? `new-${peer.session.slice(-4)}`;
		let handle = base;
		for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;
		taken.add(handle);
		const color = colorFor(peer.session, used);
		used.add(color);
		names.set(peer.session, { session: peer.session, handle, color });
	}
	return { bySession: names, aliases };
}

/** The session's own color, or the next free one when an older open session has it. */
function colorFor(session: string, used: ReadonlySet<PeerColor>): PeerColor {
	const start = hash(session) % PEER_COLORS.length;
	for (let step = 0; step < PEER_COLORS.length; step++) {
		const color = PEER_COLORS[(start + step) % PEER_COLORS.length] ?? "syntaxKeyword";
		if (!used.has(color)) return color;
	}
	return PEER_COLORS[start] ?? "syntaxKeyword";
}

function hash(text: string): number {
	let value = 0;
	for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
	return value;
}

/**
 * The open session a name points at, ignoring case and a leading @. A word a session used to have
 * reaches it too, which is what keeps `@oauth` working after the session became `auth`.
 */
export function byHandle(names: Names, name: string): Named | undefined {
	const wanted = name.replace(/^@/, "").toLowerCase();
	const named = [...names.bySession.values()].find((one) => one.handle === wanted);
	if (named !== undefined) return named;
	const session = names.aliases.get(wanted);
	return session === undefined ? undefined : names.bySession.get(session);
}

/** `@` and a name, not inside an address. A path or a file name after the `@` is a file. */
const MENTION = /(?<![\w@])@([a-z][a-z0-9-]*)(?![\w/-]|\.\w)/gi;

/** The names after each `@` in a text, in lower case. */
export function mentionedNames(text: string): string[] {
	return [...text.matchAll(MENTION)].map((match) => (match[1] ?? "").toLowerCase());
}

/** Every @name in a text that points at an open session, by its word or by one it used to have. */
export function mentionsIn(names: Names, text: string): Named[] {
	const found = new Map<string, Named>();
	for (const name of mentionedNames(text)) {
		const named = byHandle(names, name);
		if (named !== undefined) found.set(named.session, named);
	}
	return [...found.values()];
}
