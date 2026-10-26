// Where the last prompts a person sent from a client came from, offered to the other features by text.
import { type By, type EventScope, PROMPT_FROM } from "@adeildo/pi-kit";

/** Enough for a queue of follow-ups; an older prompt is drawn already. */
const KEPT = 50;

export class PromptOrigins {
	readonly #by = new Map<string, By>();

	add(text: string, by: By): void {
		const key = text.trim();
		this.#by.delete(key);
		this.#by.set(key, by);
		if (this.#by.size > KEPT) this.#by.delete(this.#by.keys().next().value ?? "");
	}

	of(text: string): By | undefined {
		return this.#by.get(text.trim());
	}

	provide(scope: EventScope): () => void {
		return PROMPT_FROM.provide(scope, (text) => this.of(text));
	}
}
