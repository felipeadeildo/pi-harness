// The session's inbox, wired to pi. The question this module answers is when a message goes in: a
// steer at once, between the agent's calls, and a follow-up only when the agent settles.
import { type By, Inbox, INBOX, INBOX_PORT, type Letter, type EventScope } from "@adeildo/pi-kit";
import type { QueuedMessage } from "@adeildo/pi-remote-protocol";

export interface InboxSession {
	send(text: string, deliverAs: "steer" | "followUp" | undefined): void;
	/**
	 * Whether a run is in flight. A follow-up only waits for the agent to settle when there is
	 * something to settle: in a session that is idle, holding it would wait for an event that never
	 * comes, and the prompt would sit in the queue until someone typed at the terminal.
	 */
	busy(): boolean;
	arrived(text: string, by: By): void;
	queued(queue: QueuedMessage[]): void;
}

/** How long a send waits for pi to start the run before the letter is left in the queue. */
const PROOF_MS = 500;

export class SessionInbox {
	readonly #inbox = new Inbox();
	#pending: string | undefined;
	#deadline: ReturnType<typeof setTimeout> | undefined;
	readonly #scope: EventScope;
	readonly #session: InboxSession;

	constructor(
		scope: EventScope,
		session: InboxSession,
		/** How long a send waits for pi to prove the run, for a test that does not wait half a second. */
		private readonly proofMs = PROOF_MS,
	) {
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
			// `sendUserMessage` returns before pi has decided anything, so the letter leaves the queue
			// only when the run it starts has begun: a send pi drops would otherwise lose it in silence.
			this.#pending = letter.id;
			this.#session.send(letter.text, undefined);
			this.#deadline = setTimeout(() => this.#expire(), this.proofMs);
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

	/**
	 * A run started, so the letter that was sent to start it is out of the queue: the proof is pi's
	 * own event, not a tick of the loop.
	 */
	started(): void {
		if (this.#pending === undefined) return;
		// The letter leaves the queue, and the reason the deadline may have written goes with it.
		this.#inbox.take([this.#pending]);
		this.#pending = undefined;
		this.#settled();
		// The queue changed, so the client is told: a take that says nothing leaves a line on screen
		// for a message that already went.
		this.#publish();
	}

	/**
	 * The deadline passed without a run: the letter stays where it is and gains the reason, which is
	 * the fact and not a guess — pi never said it started. `started()` clears it by taking the letter.
	 */
	#expire(): void {
		// A start that arrived first took the letter, and there is nothing left to say about it.
		const pending = this.#pending;
		this.#settled();
		if (pending === undefined) return;
		const letter = this.#inbox.queue().find((one) => one.id === pending);
		// Nothing changed means nothing to announce: a redundant event reads as a lost order.
		if (letter === undefined || letter.why === "not-started") return;
		this.#inbox.holdFor(letter, "not-started");
		this.#publish();
	}

	/** Ends the wait for the proof. The id stays, so a run that starts late still takes the letter. */
	#settled(): void {
		if (this.#deadline !== undefined) clearTimeout(this.#deadline);
		this.#deadline = undefined;
	}

	/** A new prompt from the terminal ends the run, so nothing it carried is a repeat any more. */
	ended(): void {
		this.#inbox.ended();
	}

	#publish(): void {
		const queue = this.#inbox.queue();
		INBOX.changed(this.#scope, { queue, sent: [...this.#inbox.sent()] });
		this.#session.queued(queue.map(queuedOf));
	}
}

/** A letter as the wire shows it: the same queue, in the shape every client draws. */
function queuedOf(letter: Letter): QueuedMessage {
	return {
		id: letter.id,
		by: letter.by,
		text: letter.text,
		want: letter.want,
		when: letter.at ?? 0,
		...(letter.why === undefined ? {} : { why: letter.why }),
	};
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
