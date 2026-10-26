// What waits to go into a session: a steer goes in at once, a follow-up waits for the agent to
// settle. The operator's letters go before the agents', each group in the order written.
import type { Letter } from "./letter.ts";

export class Inbox {
	/** Injected, so a test can hold it. */
	readonly #now: () => number;
	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	/** `queue` is the order it goes in, which is not the order it arrived in. */
	readonly #held: Letter[] = [];
	readonly #sent: Letter[] = [];
	/** This instance's memory only; the command runner rereads ids from the log after a restart. */
	readonly #done = new Set<string>();

	/** Letters waiting for the agent to settle, in the order they go in. */
	queue(): Letter[] {
		return this.#held.toSorted((left, right) => rank(left) - rank(right));
	}

	/** Steers handed to pi whose effect has not come back yet. */
	sent(): readonly Letter[] {
		return [...this.#sent];
	}

	/** What makes a resend a repeat instead of a second one. */
	seen(id: string): boolean {
		return this.#done.has(id);
	}

	/** The inbox stamps arrival, since a writer may have no clock or another machine's. */
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

	take(ids?: readonly string[]): Letter[] {
		const taken = this.queue().filter((one) => ids === undefined || ids.includes(one.id));
		for (const letter of taken) {
			this.#held.splice(this.#held.indexOf(letter), 1);
			this.#done.add(letter.id);
		}
		return taken;
	}

	/** Only held letters are returned: a steer is already inside pi. */
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

	/** A letter already held keeps its place and gains the reason. */
	holdFor(letter: Letter, why: Letter["why"]): void {
		// A letter already carried is never put back: a late reason must not resurrect a message that
		// a run is already answering.
		if (this.#done.has(letter.id)) return;
		const at = this.#held.findIndex((one) => one.id === letter.id);
		const held = why === undefined ? letter : { ...letter, why };
		if (at === -1) this.#held.push(held);
		else this.#held[at] = held;
	}

	/** Pi emptied its queue (Esc): a run still going gets the steers again, a stopped one holds them. */
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

	/** Restores arrival order. */
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
