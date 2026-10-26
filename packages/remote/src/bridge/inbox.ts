import { type By, Inbox, INBOX, INBOX_PORT, type Letter, type EventScope } from "@adeildo/pi-kit";
import type { QueuedMessage } from "@adeildo/pi-remote-protocol";

export interface InboxSession {
	send(text: string, deliverAs: "steer" | "followUp" | undefined): void;
	/** A follow-up held in an idle session would wait for an event that never comes. */
	busy(): boolean;
	arrived(text: string, by: By): void;
	queued(queue: QueuedMessage[]): void;
}

/** How long a send waits for pi to start the run before the letter stays queued. */
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
		private readonly proofMs = PROOF_MS,
	) {
		this.#scope = scope;
		this.#session = session;
	}

	start(): () => void {
		const stopPort = INBOX_PORT.provide(this.#scope, () => ({
			put: (letter) => this.put(letter),
			take: (ids) => this.take(ids),
		}));
		return stopPort;
	}

	put(letter: Letter): void {
		// Dedupes by letter for this instance; ids that survive a restart are `Commands`' job.
		if (!this.#inbox.put(letter)) return;
		// Said on arrival, not on delivery, so the terminal can take a waiting follow-up back.
		if (letter.by.kind === "client") this.#session.arrived(letter.text, letter.by);
		if (letter.want === "steer") this.#session.send(letter.text, "steer");
		else if (!this.#session.busy()) {
			// `sendUserMessage` returns before pi decides, so the letter leaves the queue only once the run
			// starts: a send pi drops would otherwise vanish.
			this.#pending = letter.id;
			this.#session.send(letter.text, undefined);
			this.#deadline = setTimeout(() => this.#expire(), this.proofMs);
		}
		this.#publish();
	}

	take(ids?: readonly string[]): Letter[] {
		const taken = this.#inbox.take(ids);
		if (taken.length > 0) this.#publish();
		return taken;
	}

	queue(): Letter[] {
		return this.#inbox.queue();
	}

	/** Delivers what waited as one run: the operator's words first, the rest as follow-ups. */
	settle(): void {
		const letters = this.#inbox.settle();
		if (letters.length === 0) return;
		for (const [at, letter] of letters.entries()) {
			this.#session.send(letter.text, at === 0 ? undefined : "followUp");
		}
		this.#publish();
	}

	started(): void {
		if (this.#pending === undefined) return;
		this.#inbox.take([this.#pending]);
		this.#pending = undefined;
		this.#settled();
		// A take that says nothing leaves a line on screen for a message already gone.
		this.#publish();
	}

	/** No run started in time: the letter stays and carries the reason. */
	#expire(): void {
		const pending = this.#pending;
		this.#settled();
		if (pending === undefined) return;
		const letter = this.#inbox.queue().find((one) => one.id === pending);
		// A redundant event reads as a lost order.
		if (letter === undefined || letter.why === "not-started") return;
		this.#inbox.holdFor(letter, "not-started");
		this.#publish();
	}

	#settled(): void {
		if (this.#deadline !== undefined) clearTimeout(this.#deadline);
		this.#deadline = undefined;
	}

	// A new prompt from the terminal ends the run, so nothing it carried is a repeat.
	ended(): void {
		this.#inbox.ended();
	}

	#publish(): void {
		const queue = this.#inbox.queue();
		INBOX.changed(this.#scope, { queue, sent: [...this.#inbox.sent()] });
		this.#session.queued(queue.map(queuedOf));
	}
}

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

export function letterOf(
	id: string,
	by: By | undefined,
	text: string,
	want: Letter["want"],
): Letter {
	return { id, by: by ?? { kind: "client", name: "a client", machine: "unknown" }, text, want };
}
