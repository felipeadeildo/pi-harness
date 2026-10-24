// The daemon's list of sessions, as a client reads it. One request, one shape, and no React: the
// screen that draws it decides what to show, and the app can be read by anything that speaks fetch.
import { isObject, type SessionFacts, type SessionSnapshot } from "@adeildo/pi-remote-protocol";

/** What `session.live` said about a session, which is the bridge's word, not the daemon's. */
export interface LiveSession {
	pid: number;
	startedAt: number;
	cwd: string;
	name?: string;
	kind: "terminal" | "background";
}

/** One session, as the daemon lists it. */
export interface ListedSession {
	machine: string;
	session: string;
	epoch: string;
	/** Whether its bridge is connected now. A lost bridge reconnects, so the session stays listed. */
	connected: boolean;
	/** Why it ended, once its bridge said so. */
	gone?: string;
	live: LiveSession;
	/** What a client draws before the replay, when the daemon holds one. */
	snapshot?: SessionSnapshot;
	facts: SessionFacts;
}

/**
 * Asks the daemon for its sessions. A row that does not decode is dropped rather than drawn half
 * way: the list is a menu, and a menu entry that opens nothing is worse than one that is missing.
 */
export async function listSessions(
	base: string,
	speaks: typeof fetch = fetch,
): Promise<ListedSession[]> {
	const answer = await speaks(new URL("/sessions", base), {
		headers: { accept: "application/json" },
	});
	if (!answer.ok) throw new Error(`the daemon answered ${answer.status} for its session list`);
	const body: unknown = await answer.json();
	if (!Array.isArray(body)) throw new Error("the daemon's session list is not a list");
	return body.filter(isListed);
}

function isListed(value: unknown): value is ListedSession {
	if (!isObject(value)) return false;
	const live = value.live;
	return (
		typeof value.machine === "string" &&
		typeof value.session === "string" &&
		typeof value.epoch === "string" &&
		typeof value.connected === "boolean" &&
		isObject(live) &&
		typeof live.pid === "number" &&
		typeof live.cwd === "string" &&
		(live.kind === "terminal" || live.kind === "background") &&
		isObject(value.facts)
	);
}
