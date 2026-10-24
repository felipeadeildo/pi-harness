// The daemon's list of sessions, as a client reads it. One request, one shape, and no React: the
// screen that draws it decides what to show, and the app can be read by anything that speaks fetch.
import {
	isObject,
	isSnapshot,
	type SessionFacts,
	type SessionSnapshot,
} from "@adeildo/pi-remote-protocol";

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
	if (!answer.ok) throw new DaemonAnswer(answer.status, "the session list");
	const body: unknown = await answer.json();
	if (!Array.isArray(body)) throw new DaemonAnswer(200, "a body that is not a list");
	return body.filter(isListed);
}

/** A refusal that keeps the code, so a screen can say "not logged in" without matching text. */
export class DaemonAnswer extends Error {
	readonly status: number;

	constructor(status: number, what: string) {
		super(`the daemon answered ${status} for ${what}`);
		this.name = "DaemonAnswer";
		this.status = status;
	}
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
		typeof live.startedAt === "number" &&
		typeof live.cwd === "string" &&
		(live.kind === "terminal" || live.kind === "background") &&
		isObject(value.facts) &&
		// The snapshot is the shape the rest of the package draws from, so it is the protocol's call.
		(value.snapshot === undefined || isSnapshot(value.snapshot))
	);
}
