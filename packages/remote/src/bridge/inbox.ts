// The session's inbox, wired to pi. A message from a client or from another agent arrives here, and
// the question this module answers is when it goes in: a steer at once, between the agent's calls, and
// a follow-up only when the agent settles, which is what lets a client show it and take it back.
import { type By, Inbox, INBOX, INBOX_PORT, type Letter, type EventScope } from "@adeildo/pi-kit";

/** What a session's inbox needs from the pi that runs it. */
export interface InboxSession {
	/** Hands text to pi: a steer goes in at once, a follow-up waits for the agent to settle. */
	send(text: string, deliverAs: "steer" | "followUp" | undefined): void;
	/**
	 * Whether a run is in flight. A follow-up only waits for the agent to settle when there is
	 * something to settle: in a session that is idle, holding it would wait for an event that never
	 * comes, and the prompt would sit in the queue until someone typed at the terminal.
	 */
	busy(): boolean;
	/** Says in the terminal that the text came from elsewhere, and who sent it. */
	arrived(text: string, by: By): void;
}

/**
 * One session's inbox, and the only way a message reaches it. It publishes its queue through `INBOX`
 * whenever it changes, so a reader can draw what waits without asking, and it takes messages through
 * `INBOX_PORT` so another feature, such as peers, reaches the same queue without importing this.
 */
export class SessionInbox {
	readonly #inbox = new Inbox();
	readonly #scope: EventScope;
	readonly #session: InboxSession;

	constructor(scope: EventScope, session: InboxSession) {
		this.#scope = scope;
		this.#session = session;
	}

	/** Offers the inbox to the process, and the events it needs. Returns what stops it. */
	start(): () => void {
		const stopPort = INBOX_PORT.provide(this.#scope, () => ({
			put: (letter) => this.put(letter),
			take: (ids) => this.take(ids),
		}));
		return stopPort;
	}

	/** A message with the one shape the inbox takes: a client's, or one another feature sends. */
	put(letter: Letter): void {
		// A repeat is not a second message: the inbox refuses it, and nothing goes to pi. This guard is
		// the instance's memory, for a re-delivery or a steer the terminal handed back. What survives a
		// restart is `Commands`, which keeps the ids from the log: those are command ids, and it is a
		// mistake to dedupe here by letter, since then the guarantee depends on the two being equal.
		if (!this.#inbox.put(letter)) return;
		// A message that did not come from this terminal says so, as the design's `From <client>: …`.
		// It says it on arrival, not on delivery: a follow-up still waits here, and the person at the
		// terminal is the one who can take it back, so they are the one who must see it.
		if (letter.by.kind === "client") this.#session.arrived(letter.text, letter.by);
		if (letter.want === "steer") this.#session.send(letter.text, "steer");
		else if (!this.#session.busy()) {
			// Nothing to wait for: this letter starts the run, so it leaves the queue the moment it goes.
			this.#inbox.take([letter.id]);
			this.#session.send(letter.text, undefined);
		}
		this.#publish();
	}

	/** Takes what waits, or the letters named: what a client shows as withdrawn, or drains. */
	take(ids?: readonly string[]): Letter[] {
		const taken = this.#inbox.take(ids);
		if (taken.length > 0) this.#publish();
		return taken;
	}

	/** What waits now, in the order it goes in. */
	queue(): Letter[] {
		return this.#inbox.queue();
	}

	/**
	 * The agent settled, so what waited goes in, one run: the operator's words before an agent's, and
	 * the rest of the run as follow-ups. Nothing waits after this, so the queue is empty until a new
	 * letter arrives.
	 */
	settle(): void {
		const letters = this.#inbox.settle();
		if (letters.length === 0) return;
		for (const [at, letter] of letters.entries()) {
			this.#session.send(letter.text, at === 0 ? undefined : "followUp");
		}
		this.#publish();
	}

	/** A new prompt from the terminal ends the run, so nothing it carried is a repeat any more. */
	ended(): void {
		this.#inbox.ended();
	}

	#publish(): void {
		INBOX.changed(this.#scope, { queue: this.#inbox.queue(), sent: [...this.#inbox.sent()] });
	}
}

/** A letter from whoever asked, with a fallback name for a client that sent none. */
export function letterOf(
	id: string,
	by: By | undefined,
	text: string,
	want: Letter["want"],
): Letter {
	return { id, by: by ?? { kind: "client", name: "a client", machine: "unknown" }, text, want };
}
