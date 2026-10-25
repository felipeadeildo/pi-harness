// The queue of what is waiting to go into a session, kept apart from pi so it can be tested alone and
// mirrored by a client: a steer goes in at once, a follow-up waits here until the agent settles, and
// what waits can be taken back. The order is the operator's first, then the agents', and it is the
// order they were written in inside each group.
import type { Letter } from "./letter.ts";

export class Inbox {
	/** The clock, injected so a test can hold it. */
	readonly #now: () => number;
	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	/** Every held follow-up, in the order it arrived. `queue` is the order it goes in. */
	readonly #held: Letter[] = [];
	readonly #sent: Letter[] = [];
	/**
	 * Ids already taken in this run, so a client's resend is not delivered twice. This is memory
	 * of this instance, not the authority: the authority is the log, which the command runner reads
	 * back when it starts, so a resend across a restart is still a repeat. What has to be recorded
	 * is the command's id, not the letter's: if a command's id changed on its way in, two guards
	 * would disagree after a restart and nothing would catch it.
	 */
	readonly #done = new Set<string>();

	/** Letters waiting for the agent to settle, in the order they go in. */
	queue(): Letter[] {
		return this.#held.toSorted((left, right) => rank(left) - rank(right));
	}

	/** Steers handed to pi whose effect has not come back yet. */
	sent(): readonly Letter[] {
		return [...this.#sent];
	}

	/** Whether this letter was already taken, which makes a resend a repeat instead of a second one. */
	seen(id: string): boolean {
		return this.#done.has(id);
	}

	/**
	 * Adds a letter. An id the inbox already had, or one a run carried, is a repeat and changes
	 * nothing: a client that retries a steer must not steer twice.
	 */
	/**
	 * Takes a letter in and answers whether it did: one already carried or held is not taken twice. The
	 * inbox is what tells when a letter arrived, since a writer need not carry a clock, and a client
	 * that does is on another machine's clock anyway.
	 */
	put(letter: Letter): boolean {
		if (this.#done.has(letter.id) || this.#held.some((one) => one.id === letter.id)) return false;
		if (this.#sent.some((one) => one.id === letter.id)) return false;
		const stamped = letter.at === undefined ? { ...letter, at: this.#now() } : letter;
		if (stamped.want === "steer") {
			this.#sent.push(stamped);
			this.#done.add(stamped.id);
		} else this.#held.push(stamped);
		return true;
	}

	/**
	 * Takes the held letters named, or all of them: what is drained into a run, or taken back. A steer
	 * is not here, because it is already inside pi.
	 */
	take(ids?: readonly string[]): Letter[] {
		const taken = this.queue().filter((one) => ids === undefined || ids.includes(one.id));
		for (const letter of taken) {
			this.#held.splice(this.#held.indexOf(letter), 1);
			this.#done.add(letter.id);
		}
		return taken;
	}

	/**
	 * The run that starts now takes what waited, in the order it goes in. Only the held letters are
	 * answered: a steer was handed to pi when it was put, and answering it again would send it twice.
	 * The steers on their way are forgotten, because the run they went into has begun.
	 */
	settle(): Letter[] {
		const letters = this.queue();
		this.#sent.length = 0;
		for (const letter of letters) {
			const at = this.#held.indexOf(letter);
			if (at !== -1) this.#held.splice(at, 1);
			this.#done.add(letter.id);
		}
		return letters;
	}

	/**
	 * Holds a letter that is not ready to go yet, with the reason the client reads. A letter already
	 * held keeps its place and gains the reason: the reason can be learned later than the holding.
	 */
	holdFor(letter: Letter, why: Letter["why"]): void {
		const at = this.#held.findIndex((one) => one.id === letter.id);
		const held = why === undefined ? letter : { ...letter, why };
		if (at === -1) this.#held.push(held);
		else this.#held[at] = held;
	}

	/**
	 * pi emptied the queue it was handed, as Esc and taking your queued messages back both do, and the
	 * steers in it went with it. A run that goes on gets them again, as steers; one that stopped leaves
	 * them waiting for the next run, with the reason. The inbox sends nothing: the caller does.
	 */
	cleared(letters: readonly Letter[], running: boolean): { resend: Letter[]; held: Letter[] } {
		const gone = letters.filter((one) => one.want === "steer");
		this.#sent.length = 0;
		// What comes back is not a repeat any more: whoever sends it again may put it again too.
		for (const letter of gone) this.#done.delete(letter.id);
		if (running) return { resend: gone, held: [] };
		const held = gone.map((one) => ({ ...one, why: "stopped" as const }));
		for (const letter of held) this.holdFor(letter, "stopped");
		return { resend: [], held };
	}

	/**
	 * Puts held letters back that a run carried and pi no longer holds, as pi's queue shows what it
	 * has. The order of arrival comes back with them, so a letter written before another is still first.
	 */
	hold(letters: readonly Letter[]): void {
		for (const letter of letters) {
			if (letter.want !== "followUp" || !this.#done.has(letter.id)) continue;
			this.#done.delete(letter.id);
			this.#held.push(letter);
		}
	}

	/** The run ended, so nothing it carried is a repeat any more: the next prompt may say it again. */
	ended(): void {
		this.#done.clear();
	}

	/** A new run starts, so nothing from the one before is a repeat any more. */
	reset(): void {
		this.#held.length = 0;
		this.#sent.length = 0;
		this.#done.clear();
	}
}

/** Zero for what the operator wrote, one for what an agent wrote. */
function rank(letter: Letter): number {
	return letter.by.kind === "agent" ? 1 : 0;
}
