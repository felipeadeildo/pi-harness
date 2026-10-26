// The folder as every session sees it, rebuilt from the logs. Every session reads the same events,
// so each one reaches the same board, the same room and the same winner of a request.
import {
	type Activity,
	type BoardView,
	type Delivery,
	type Lives,
	type LoggedEvent,
	type RoomActivity,
	type RoomMode,
} from "@adeildo/pi-kit";

import { Membership } from "./membership.ts";

const KEEP_RUNS = 5;

export interface Peer {
	session: string;
	pid?: number;
	/** When its process started, which tells it from a later process with the same pid. */
	start?: string;
	host?: string;
	model?: string;
	/** Where it works. Its edited paths are relative to this. Absent in logs older than rooms. */
	cwd?: string;
	startedAt: number;
	endedAt?: number;
	handle?: string;
	state: RoomActivity;
	stateAt: number;
	/** The operator wrote here at least once. Until then nothing from the room wakes it. */
	prompted?: boolean;
	/**
	 * The board the session last wrote into this room. A room has no board of its own: a reader draws
	 * the board of the session it chose, and nothing is merged.
	 */
	board?: BoardView;
	edited: Map<string, number>;
	ran: { command: string; ok: boolean; at: number }[];
	commits: { sha: string; subject: string; at: number }[];
}

interface Bid {
	fit: number;
	reason: string;
	idle: boolean;
	at: number;
}

export interface Posted {
	id: string;
	session: string;
	from: "you" | "agent";
	/** Session ids, "all" for every session, or "any" for a request one of them takes. */
	to: string[] | "all" | "any";
	text: string;
	urgent: boolean;
	/** How many agent replies, each waking the next writer, led to it. */
	depth: number;
	at: number;
	received: Map<string, { mode: Delivery; at: number }>;
	read: Set<string>;
	bids: Map<string, Bid>;
	takenBy?: string;
}

/**
 * Whether a message reaches the session: one sent to it, or one sent to everyone. An agent's message
 * to everyone does not come back to its own session; yours does, so the agent there knows it too.
 */
export function reaches(message: Posted, session: string): boolean {
	if (message.to === "any") return false;
	if (message.to === "all") return !(message.from === "agent" && message.session === session);
	return message.to.includes(session);
}

/**
 * Whether a session standing in `mode` takes this message. Taking part takes what `reaches` says;
 * listening takes only what names the session, and nothing addressed to the room, because
 * `@everyone` and `@anyone` are addresses of the ones taking part; out takes nothing.
 */
export function receivesFor(mode: RoomMode, message: Posted, session: string): boolean {
	if (mode === "out") return false;
	if (mode === "listening")
		return message.to !== "all" && message.to !== "any" && message.to.includes(session);
	return reaches(message, session);
}

/**
 * The sessions a message went to. One to everyone went to every session it reaches: those that got
 * it, and those open now.
 */
export function addressees(message: Posted, live: readonly Peer[]): string[] {
	if (message.to === "any") return [];
	if (message.to !== "all") return message.to;
	const sessions = new Set([...message.received.keys(), ...live.map((peer) => peer.session)]);
	return [...sessions].filter((session) => reaches(message, session));
}

/** A line of the room that is not a message: someone came, left, committed or finished a card. */
export type Happening =
	| { kind: "joined" | "left"; session: string; at: number }
	| { kind: "committed"; session: string; at: number; sha: string; subject: string }
	| { kind: "finished"; session: string; at: number; title: string }
	| { kind: "took"; session: string; at: number; request: string };

export type RoomItem =
	| { kind: "message"; message: Posted }
	| { kind: "happening"; happening: Happening };

const FOLDED = new Set([
	"session.started",
	"session.ended",
	"session.named",
	"session.state",
	"session.prompted",
	"board.changed",
	"activity",
	"message.posted",
	"message.received",
	"message.read",
	"request.bid",
	"request.taken",
]);

/** Whether a room folds an event of this type; its feeds skip the others unparsed. */
export function folds(type: string): boolean {
	return type.startsWith("room.") || FOLDED.has(type);
}

export class Folder {
	readonly peers = new Map<string, Peer>();
	readonly messages = new Map<string, Posted>();
	readonly room: RoomItem[] = [];
	/** Who counts in this room, folded from its `room.*` events. */
	readonly membership = new Membership();
	/**
	 * A room of one folder. The folder is its first member, so a session opened there is in before
	 * any `room.added` says so, and the rule for how a session stands lives in one place.
	 */
	constructor(folder?: string) {
		if (folder !== undefined) this.membership.folders.set(folder, 0);
	}

	/** Counts the reads that brought events, so what is worked out from the folder knows it is stale. */
	version = 0;

	apply(events: readonly LoggedEvent[]): void {
		if (events.length > 0) this.version++;
		for (const event of events) this.#apply(event);
	}

	#apply(event: LoggedEvent): void {
		// Who changed the room need not be in it, so a `room.*` line makes nobody a peer.
		if (event.type.startsWith("room.")) return this.membership.apply(event);
		const peer = this.#peer(event.session, event.at);
		switch (event.type) {
			case "session.started": {
				const data = event.data as LoggedEvent<"session.started">["data"];
				Object.assign(peer, {
					pid: data.pid,
					start: data.start,
					host: data.host,
					model: data.model,
					cwd: data.cwd,
				});
				peer.endedAt = undefined;
				this.#happen({ kind: "joined", session: peer.session, at: event.at });
				return;
			}
			case "session.ended":
				peer.endedAt = event.at;
				peer.state = "idle";
				this.#happen({ kind: "left", session: peer.session, at: event.at });
				return;
			case "session.named": {
				const { handle } = event.data as LoggedEvent<"session.named">["data"];
				if (handle !== undefined) peer.handle = handle;
				return;
			}
			case "session.state": {
				const state = (event.data as LoggedEvent<"session.state">["data"]).state;
				if (state !== peer.state) peer.stateAt = event.at;
				peer.state = state;
				return;
			}
			case "session.prompted":
				peer.prompted = true;
				return;
			case "board.changed":
				return this.#board(
					peer,
					(event.data as LoggedEvent<"board.changed">["data"]).view,
					event.at,
				);
			case "activity":
				return this.#activity(peer, event.data as Activity, event.at);
			case "message.posted":
				return this.#posted(event as LoggedEvent<"message.posted">);
			default:
				return this.#about(event);
		}
	}

	/** Receipts, bids and takes, which all point at a message. */
	#about(event: LoggedEvent): void {
		const data = event.data as { id?: string; request?: string };
		const message = this.messages.get(data.id ?? data.request ?? "");
		if (message === undefined) return;
		switch (event.type) {
			case "message.received":
				message.received.set(event.session, {
					mode: (event.data as LoggedEvent<"message.received">["data"]).mode,
					at: event.at,
				});
				return;
			case "message.read":
				message.read.add(event.session);
				return;
			case "request.bid": {
				const { fit, reason, idle } = event.data as LoggedEvent<"request.bid">["data"];
				message.bids.set(event.session, { fit, reason, idle, at: event.at });
				return;
			}
			case "request.taken":
				if (message.takenBy !== undefined) return;
				message.takenBy = event.session;
				this.#happen({ kind: "took", session: event.session, at: event.at, request: message.id });
				return;
			default:
				return;
		}
	}

	#posted(event: LoggedEvent<"message.posted">): void {
		const { id, from, to, text, urgent, depth } = event.data;
		if (this.messages.has(id)) return;
		const message: Posted = {
			id,
			session: event.session,
			from,
			to,
			text,
			urgent: urgent === true,
			depth: depth ?? 0,
			at: event.at,
			received: new Map(),
			read: new Set(),
			bids: new Map(),
		};
		this.messages.set(id, message);
		this.room.push({ kind: "message", message });
	}

	#board(peer: Peer, view: BoardView, at: number): void {
		// The first board is where the session was, not something it just finished. The view carries
		// the last done cards only, so a card is finished when it enters them.
		if (peer.board !== undefined) {
			const before = new Set(peer.board.done.map((card) => card.id));
			for (const card of view.done)
				if (!before.has(card.id))
					this.#happen({ kind: "finished", session: peer.session, at, title: card.title });
		}
		peer.board = view;
	}

	#activity(peer: Peer, activity: Activity, at: number): void {
		switch (activity.kind) {
			case "edited":
				peer.edited.set(activity.path, at);
				return;
			case "ran":
				peer.ran = [...peer.ran, { command: activity.command, ok: activity.ok, at }].slice(
					-KEEP_RUNS,
				);
				return;
			case "committed":
				peer.commits = [
					...peer.commits,
					{ sha: activity.sha, subject: activity.subject, at },
				].slice(-KEEP_RUNS);
				this.#happen({
					kind: "committed",
					session: peer.session,
					at,
					sha: activity.sha,
					subject: activity.subject,
				});
				return;
		}
	}

	#happen(happening: Happening): void {
		this.room.push({ kind: "happening", happening });
	}

	#peer(session: string, at: number): Peer {
		let peer = this.peers.get(session);
		if (peer === undefined) {
			peer = {
				session,
				startedAt: at,
				state: "idle",
				stateAt: at,
				edited: new Map(),
				ran: [],
				commits: [],
			};
			this.peers.set(session, peer);
		}
		return peer;
	}
}

/**
 * Open sessions in the folder, oldest first. A session on this machine is open while its process
 * runs, and one on another machine while that machine says so, which `elsewhere` reads only when a
 * peer of another machine is there to ask about.
 */
export function livePeers(
	folder: Folder,
	lives: Lives,
	host: string,
	elsewhere: () => ReadonlySet<string>,
): Peer[] {
	let open: ReadonlySet<string> | undefined;
	return [...folder.peers.values()]
		.filter((peer) => peer.endedAt === undefined && peer.pid !== undefined)
		.filter((peer) => {
			if (peer.host === undefined || peer.host === host) return lives(peer.pid ?? -1, peer.start);
			open ??= elsewhere();
			return open.has(peer.session);
		})
		.toSorted((a, b) => a.startedAt - b.startedAt || a.session.localeCompare(b.session));
}
