// What the daemon knows about each session a bridge registered: who it is, whether its bridge is
// connected, the facts reduced from its events, and a replay buffer so a client that missed a few
// events catches up from its cursor instead of taking a new snapshot.
import {
	emptySessionFacts,
	type Envelope,
	isObject,
	isSnapshot,
	reduceFact,
	type SessionFacts,
	type SessionSnapshot,
} from "@adeildo/pi-remote-protocol";

/** The replay buffers of every session together hold at most this many bytes of JSON. */
export const REPLAY_BYTES = 8 * 1024 * 1024;

/** Events that only matter while they happen, so they never reach the replay buffer. */
export const EPHEMERAL: ReadonlySet<string> = new Set([
	"pi.message_update",
	"pi.tool_execution_update",
	"presence.changed",
	"draft.typed",
]);

export type GoneReason = "exit" | "crash" | "unanswered" | "replaced";

/** What `session.live` says about a session. */
export interface SessionLive {
	pid: number;
	startedAt: number;
	cwd: string;
	name?: string;
	kind: "terminal" | "background";
}

export interface LiveSession {
	machine: string;
	session: string;
	/** The life of the bridge that registered it last. */
	epoch: string;
	live: SessionLive;
	/** Whether its bridge is connected now. A lost bridge reconnects, so the session stays listed. */
	connected: boolean;
	/** Why it ended, once its bridge said so. */
	gone?: GoneReason;
	facts: SessionFacts;
	/** The last snapshot its bridge sent: what a client draws before the replay. */
	snapshot?: SnapshotEvent;
}

/** What a bridge's `snapshot` event carries. */
export interface SnapshotEvent {
	snapshot: SessionSnapshot;
	/** The tail of the branch, oldest first. */
	entries: unknown[];
	/** The message being written, when one is. */
	streaming?: unknown;
}

/** Where a client stopped reading a session's live stream. */
export interface Cursor {
	epoch: string;
	seq: number;
}

interface Buffered {
	envelope: Envelope;
	bytes: number;
}

interface Entry {
	state: LiveSession;
	replay: Buffered[];
	/** What `replay` holds, in bytes of JSON. */
	bytes: number;
	/** The highest seq dropped from the replay buffer: a cursor at or below it has a gap. */
	evicted: number;
}

export class Sessions {
	readonly #entries = new Map<string, Entry>();
	#bytes = 0;

	constructor(private readonly budget = REPLAY_BYTES) {}

	/** Every session a bridge registered, connected or not, oldest first. */
	list(): LiveSession[] {
		return [...this.#entries.values()].map((entry) => entry.state);
	}

	get(session: string): LiveSession | undefined {
		return this.#entries.get(session)?.state;
	}

	/** How many sessions have a connected bridge. */
	connected(): number {
		return this.list().filter((state) => state.connected).length;
	}

	/**
	 * A bridge registered its session. A new epoch starts a new numbering, so the replay buffer of the
	 * old one goes, and the facts stay: they describe the session, not one life of its process.
	 */
	live(envelope: Envelope, live: SessionLive): LiveSession {
		const { machine = "", session = "", epoch = "" } = envelope;
		const known = this.#entries.get(session);
		if (known === undefined || known.state.epoch !== epoch) this.#drop(known);
		const state: LiveSession = {
			machine,
			session,
			epoch,
			live,
			connected: true,
			facts: known?.state.facts ?? emptySessionFacts(),
			...(same(known, epoch) && known?.state.snapshot !== undefined
				? { snapshot: known.state.snapshot }
				: {}),
		};
		const kept = same(known, epoch) ? known : undefined;
		this.#entries.set(session, {
			state,
			replay: kept?.replay ?? [],
			bytes: kept?.bytes ?? 0,
			evicted: kept?.evicted ?? -1,
		});
		return state;
	}

	/**
	 * An event of a registered session: reduced into its facts, and kept for replay unless ephemeral.
	 * Returns why it was dropped, for the daemon's log.
	 */
	event(envelope: Envelope): string | undefined {
		const entry = this.#entries.get(envelope.session ?? "");
		if (entry === undefined) return "an event for a session no bridge registered";
		if (entry.state.epoch !== envelope.epoch) return "an event from another life of the session";
		if (envelope.type === "snapshot") {
			if (!isSnapshotEvent(envelope.data)) return "a snapshot that does not read";
			this.#rebase(entry, envelope.data, envelope.seq);
			return undefined;
		}
		entry.state.facts = reduceFact(entry.state.facts, envelope.type, envelope.data);
		if (EPHEMERAL.has(envelope.type) || envelope.seq === undefined) return undefined;
		const bytes = JSON.stringify(envelope).length;
		entry.replay.push({ envelope, bytes });
		entry.bytes += bytes;
		this.#bytes += bytes;
		this.#evict();
		return undefined;
	}

	/** Its bridge's socket closed without saying the session ended. */
	lost(session: string, epoch: string): void {
		const entry = this.#entries.get(session);
		if (entry !== undefined && entry.state.epoch === epoch) entry.state.connected = false;
	}

	/** Its bridge said the session ended. */
	gone(session: string, epoch: string, reason: GoneReason): void {
		const entry = this.#entries.get(session);
		if (entry === undefined || entry.state.epoch !== epoch) return;
		entry.state.connected = false;
		entry.state.gone = reason;
	}

	/**
	 * The events after `cursor`, oldest first, or `undefined` when the buffer cannot fill the gap: the
	 * epoch changed, or the events after the cursor were dropped. Then the client takes a snapshot.
	 */
	after(session: string, cursor: Cursor): Envelope[] | undefined {
		const entry = this.#entries.get(session);
		if (entry === undefined || entry.state.epoch !== cursor.epoch) return undefined;
		if (cursor.seq < entry.evicted) return undefined;
		return entry.replay
			.filter(({ envelope }) => (envelope.seq ?? -1) > cursor.seq)
			.map(({ envelope }) => envelope);
	}

	/**
	 * A snapshot is the new base: the client that reads it starts from its seq, and a cursor older
	 * than it takes the snapshot instead of a replay.
	 */
	#rebase(entry: Entry, snapshot: SnapshotEvent, seq: number | undefined): void {
		entry.state.snapshot = snapshot;
		this.#drop(entry);
		entry.evicted = Math.max(entry.evicted, seq ?? -1);
	}

	#drop(entry: Entry | undefined): void {
		if (entry === undefined) return;
		this.#bytes -= entry.bytes;
		entry.replay = [];
		entry.bytes = 0;
	}

	/** Over the budget, the oldest event of the session that holds the most bytes goes first. */
	#evict(): void {
		while (this.#bytes > this.budget) {
			let largest: Entry | undefined;
			for (const entry of this.#entries.values())
				if (entry.bytes > (largest?.bytes ?? 0)) largest = entry;
			const oldest = largest?.replay.shift();
			if (largest === undefined || oldest === undefined) return;
			largest.bytes -= oldest.bytes;
			this.#bytes -= oldest.bytes;
			largest.evicted = Math.max(largest.evicted, oldest.envelope.seq ?? -1);
		}
	}
}

function same(entry: Entry | undefined, epoch: string): entry is Entry {
	return entry?.state.epoch === epoch;
}

function isSnapshotEvent(value: unknown): value is SnapshotEvent {
	return isObject(value) && isSnapshot(value.snapshot) && Array.isArray(value.entries);
}
