// The queue of what is waiting to go into a session, kept apart from pi so it can be tested alone and
// mirrored by a client: a steer goes in at once, a follow-up waits here until the agent settles, and
// what waits can be taken back. The order is the operator's first, then the agents', and it is the
// order they were written in inside each group.
import type { Letter } from "./letter.ts";

export class Inbox {
	/** Every held follow-up, in the order it arrived. `queue` is the order it goes in. */
	readonly #held: Letter[] = [];
	readonly #sent: Letter[] = [];
	/** Ids already taken in this run, so a client's resend is not delivered twice. */
	readonly #done = new Set<string>();

	/** Letters waiting for the agent to settle, in the order they go in. */
	queue(): Letter[] {
		return this.#held.toSorted((left, right) => rank(left) - rank(right));
	}

	/** Steers handed to pi whose effect has not come back yet. */
	sent(): readonly Letter[] {
		return this.#sent;
	}

	/** Whether this letter was already taken, which makes a resend a repeat instead of a second one. */
	seen(id: string): boolean {
		return this.#done.has(id);
	}

	put(letter: Letter): void {
		if (this.#done.has(letter.id) || this.#held.some((one) => one.id === letter.id)) return;
		if (letter.want === "steer") this.#sent.push(letter);
		else this.#held.push(letter);
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
	 * The run that starts now: the steers on their way, then the held letters in the order they go in.
	 * Whatever it carries is a repeat from here on, so a resend of it is not a second message.
	 */
	settle(): Letter[] {
		const letters = [...this.#sent.splice(0), ...this.queue()];
		for (const letter of letters) {
			const at = this.#held.indexOf(letter);
			if (at !== -1) this.#held.splice(at, 1);
			this.#done.add(letter.id);
		}
		return letters;
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
