// What the daemon knows of each session: its bridge, its folded state, and a replay buffer so a
// client that missed a few events catches up without a new opening.
import {
	emptySessionState,
	type Envelope,
	isObject,
	isSummary,
	isStateChangeType,
	applyChange,
	applyPi,
	type SessionState,
	type SessionSummary,
} from "@adeildo/pi-remote-protocol";

/** Shared by every session's replay. */
const REPLAY_BYTES = 8 * 1024 * 1024;

const EPHEMERAL: ReadonlySet<string> = new Set([
	"pi.message_update",
	"pi.tool_execution_update",
	"presence.changed",
	"draft.typed",
]);

export type GoneReason = "exit" | "crash" | "unanswered" | "replaced";

export interface SessionLive {
	pid: number;
	startedAt: number;
	cwd: string;
	name?: string;
	kind: "terminal" | "background";
	file?: string;
}

export interface LiveSession {
	machine: string;
	session: string;
	epoch: string;
	live: SessionLive;
	/** A lost bridge reconnects, so the session stays listed. */
	connected: boolean;
	gone?: GoneReason;
	state: SessionState;
	opening?: Opening;
}

export interface Opening {
	summary: SessionSummary;
	entries: unknown[];
	streaming?: unknown;
}

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
	opening?: Envelope;
	replay: Buffered[];
	bytes: number;
	/** A cursor at or below it has a gap. */
	evicted: number;
}

export class Sessions {
	readonly #entries = new Map<string, Entry>();
	#bytes = 0;

	constructor(private readonly budget = REPLAY_BYTES) {}

	list(): LiveSession[] {
		return [...this.#entries.values()].map((entry) => entry.state);
	}

	get(session: string): LiveSession | undefined {
		return this.#entries.get(session)?.state;
	}

	connected(): number {
		return this.list().filter((state) => state.connected).length;
	}

	/** A new epoch renumbers: the replay goes, the state stays. */
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

	event(envelope: Envelope): string | undefined {
		const entry = this.#entries.get(envelope.session ?? "");
		if (entry === undefined) return "an event for a session no bridge registered";
		if (entry.state.epoch !== envelope.epoch) return "an event from another life of the session";
		if (envelope.type === "state") {
			if (!isOpening(envelope.data)) return "an opening that does not read";
			this.#rebase(entry, envelope, envelope.data);
			return undefined;
		}
		// Deltas and bindings travel without folding.
		if (isStateChangeType(envelope.type))
			entry.state.state = applyChange(entry.state.state, envelope.type, envelope.data);
		// Pi's own name, model and thinking, so the list shows a rename before the next opening.
		else entry.state.state = applyPi(entry.state.state, envelope.type, envelope.data);
		if (EPHEMERAL.has(envelope.type) || envelope.seq === undefined) return undefined;
		const bytes = JSON.stringify(envelope).length;
		entry.replay.push({ envelope, bytes });
		entry.bytes += bytes;
		this.#bytes += bytes;
		this.#evict();
		return undefined;
	}

	lost(session: string, epoch: string): void {
		const entry = this.#entries.get(session);
		if (entry !== undefined && entry.state.epoch === epoch) entry.state.connected = false;
	}

	gone(session: string, epoch: string, reason: GoneReason): void {
		const entry = this.#entries.get(session);
		if (entry === undefined || entry.state.epoch !== epoch) return;
		entry.state.connected = false;
		entry.state.gone = reason;
	}

	after(session: string, cursor: Cursor): Envelope[] | undefined {
		const entry = this.#entries.get(session);
		if (entry === undefined || entry.state.epoch !== cursor.epoch) return undefined;
		if (cursor.seq < entry.evicted) return undefined;
		return entry.replay
			.filter(({ envelope }) => (envelope.seq ?? -1) > cursor.seq)
			.map(({ envelope }) => envelope);
	}

	opening(session: string): Envelope[] | undefined {
		const entry = this.#entries.get(session);
		const opening = entry?.opening;
		if (entry === undefined || opening === undefined) return undefined;
		const after = this.after(session, { epoch: opening.epoch ?? "", seq: opening.seq ?? -1 });
		if (after === undefined) return undefined;
		return [this.#foldedInto(entry, opening), ...after];
	}

	/** A cursor older than the opening takes the opening instead of a replay. */
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

	/** The session holding the most bytes loses its oldest event first. */
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
