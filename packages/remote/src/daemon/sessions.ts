// What the daemon knows of each session: its bridge, its folded state, and a replay buffer so a
// client that missed a few events catches up without a new opening.
import {
	emptySessionState,
	type Envelope,
	isObject,
	isSummary,
	isStateChangeType,
	applyChange,
	type SessionState,
	type SessionSummary,
} from "@adeildo/pi-remote-protocol";

/** Every session's replay together holds at most this many bytes of JSON. */
const REPLAY_BYTES = 8 * 1024 * 1024;

/** Events that only matter while they happen. */
const EPHEMERAL: ReadonlySet<string> = new Set([
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
	/** Once pi wrote one, where older entries come from. */
	file?: string;
}

export interface LiveSession {
	machine: string;
	session: string;
	/** The life of the last bridge that registered it. */
	epoch: string;
	live: SessionLive;
	/** A lost bridge reconnects, so the session stays listed. */
	connected: boolean;
	/** Why it ended, once a bridge said so. */
	gone?: GoneReason;
	state: SessionState;
	/** The last opening a bridge sent. */
	opening?: Opening;
}

/** What the bridge's `state` event carries. */
export interface Opening {
	summary: SessionSummary;
	/** The tail of the branch, oldest first. */
	entries: unknown[];
	/** The message being written, when one is. */
	streaming?: unknown;
}

/** Where a client stopped reading. */
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
	/** As its bridge sent it, so a client gets its epoch and seq too. */
	opening?: Envelope;
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

	/** Every session a bridge registered, connected or not. */
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

	/** A new epoch renumbers, so the old replay goes and the state stays: it describes the session. */
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
			state: known?.state.state ?? emptySessionState(),
			...(same(known, epoch) && known?.state.opening !== undefined
				? { opening: known.state.opening }
				: {}),
		};
		const kept = same(known, epoch) ? known : undefined;
		this.#entries.set(session, {
			state,
			...(kept?.opening === undefined ? {} : { opening: kept.opening }),
			replay: kept?.replay ?? [],
			bytes: kept?.bytes ?? 0,
			evicted: kept?.evicted ?? -1,
		});
		return state;
	}

	/** An event of a registered session: folded, and kept for replay unless ephemeral. */
	event(envelope: Envelope): string | undefined {
		const entry = this.#entries.get(envelope.session ?? "");
		if (entry === undefined) return "an event for a session no bridge registered";
		if (entry.state.epoch !== envelope.epoch) return "an event from another life of the session";
		if (envelope.type === "state") {
			if (!isOpening(envelope.data)) return "an opening that does not read";
			this.#rebase(entry, envelope, envelope.data);
			return undefined;
		}
		// Only state changes fold: a delta or a bound travels for the client.
		if (isStateChangeType(envelope.type))
			entry.state.state = applyChange(entry.state.state, envelope.type, envelope.data);
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

	/** The events after `cursor`, or `undefined` when the buffer cannot fill the gap. */
	after(session: string, cursor: Cursor): Envelope[] | undefined {
		const entry = this.#entries.get(session);
		if (entry === undefined || entry.state.epoch !== cursor.epoch) return undefined;
		if (cursor.seq < entry.evicted) return undefined;
		return entry.replay
			.filter(({ envelope }) => (envelope.seq ?? -1) > cursor.seq)
			.map(({ envelope }) => envelope);
	}

	/** What a client with no usable cursor reads first: the last opening, then the events after it. */
	opening(session: string): Envelope[] | undefined {
		const entry = this.#entries.get(session);
		const opening = entry?.opening;
		if (entry === undefined || opening === undefined) return undefined;
		const after = this.after(session, { epoch: opening.epoch ?? "", seq: opening.seq ?? -1 });
		if (after === undefined) return undefined;
		return [this.#foldedInto(entry, opening), ...after];
	}

	/** An opening is the new base: a cursor older than it takes the opening instead of a replay. */
	#rebase(entry: Entry, envelope: Envelope, opening: Opening): void {
		entry.state.opening = opening;
		// The bridge's folded state seeds the daemon. An opening without one keeps the fold: absent
		// means unchanged across the protocol.
		entry.state.state = opening.summary.state ?? entry.state.state;
		entry.opening = envelope;
		this.#drop(entry);
		entry.evicted = Math.max(entry.evicted, envelope.seq ?? -1);
	}

	#foldedInto(entry: Entry, opening: Envelope): Envelope {
		const data = opening.data;
		if (!isObject(data) || !isObject(data.summary) || data.summary.state !== undefined)
			return opening;
		return {
			...opening,
			data: { ...data, summary: { ...data.summary, state: entry.state.state } },
		};
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

function isOpening(value: unknown): value is Opening {
	return isObject(value) && isSummary(value.summary) && Array.isArray(value.entries);
}
