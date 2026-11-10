// The agents a session started, so it keeps at most a few open. A slot is taken before the dialog,
// so two calls at once cannot both pass; a started agent counts until it was seen open and left.
import { isObject } from "@adeildo/pi-kit";

/** One per agent this session started, so the count survives a reload. */
export const PEER_STARTED = "pi-peers:started";

/** An agent that never showed up, say one without peers, stops counting after this. */
const UNSEEN_MS = 5 * 60_000;

export function isStartedEntry(value: unknown): value is { session: string } {
	return isObject(value) && typeof value.session === "string";
}

export class Started {
	readonly #open = new Map<string, { seen: boolean; at: number }>();
	readonly #now: () => number;
	#pending = 0;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	/** From the session's entries: those agents were seen, or they never will be. */
	restore(session: string): void {
		this.#open.set(session, { seen: true, at: this.#now() });
	}

	/** A slot, or undefined when `limit` are open or on their way. */
	reserve(live: ReadonlySet<string>, limit: number): (() => void) | undefined {
		if (this.open(live) + this.#pending >= limit) return undefined;
		this.#pending++;
		let held = true;
		return () => {
			if (held) this.#pending--;
			held = false;
		};
	}

	/** Called with the slot's release once the remote answered with the new session. */
	add(session: string): void {
		this.#open.set(session, { seen: false, at: this.#now() });
	}

	open(live: ReadonlySet<string>): number {
		for (const [session, one] of this.#open) {
			if (live.has(session)) one.seen = true;
			else if (one.seen || this.#now() - one.at > UNSEEN_MS) this.#open.delete(session);
		}
		return this.#open.size;
	}
}
