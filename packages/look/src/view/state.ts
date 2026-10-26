// A viewed session's folded state and scroll position, kept apart from drawing so it tests without a terminal.
import type { SessionSummary, SourceItem } from "@adeildo/pi-kit";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export class ViewState {
	readonly #entries: SessionEntry[] = [];
	readonly #ids = new Set<string>();
	#summary: SessionSummary | undefined;
	#ended = false;
	/** So a drawing can tell it is stale. */
	#version = 0;

	get entries(): readonly SessionEntry[] {
		return this.#entries;
	}

	get snapshot(): SessionSummary | undefined {
		return this.#summary;
	}

	get ended(): boolean {
		return this.#ended;
	}

	get version(): number {
		return this.#version;
	}

	get last(): string | undefined {
		return this.#entries.at(-1)?.id;
	}

	apply(item: SourceItem): boolean {
		switch (item.kind) {
			case "entry":
				if (this.#ids.has(item.entry.id)) return false;
				this.#ids.add(item.entry.id);
				this.#entries.push(item.entry);
				break;
			case "summary":
				this.#summary = item.summary;
				break;
			case "reset":
				this.#entries.length = 0;
				this.#ids.clear();
				break;
			case "ended":
				if (this.#ended) return false;
				this.#ended = true;
				break;
		}
		this.#version++;
		return true;
	}
}

/** Counted from the end. At the end it follows; scrolled back, the lines being read stay put. */
export class Viewport {
	#fromEnd = 0;
	#total = 0;
	#height = 0;

	get following(): boolean {
		return this.#fromEnd === 0;
	}

	/** `[start, end)`. */
	window(total: number, height: number): { start: number; end: number } {
		// Lines arriving below while scrolled back push the end away, not the reader.
		if (this.#fromEnd > 0 && total > this.#total) this.#fromEnd += total - this.#total;
		this.#total = total;
		this.#height = height;
		this.#fromEnd = clamp(this.#fromEnd, 0, Math.max(0, total - height));
		const end = total - this.#fromEnd;
		return { start: Math.max(0, end - height), end };
	}

	scroll(rows: number): void {
		this.#fromEnd = clamp(this.#fromEnd - rows, 0, Math.max(0, this.#total - this.#height));
	}

	page(direction: -1 | 1): void {
		this.scroll(direction * Math.max(1, this.#height - 1));
	}

	toEnd(): void {
		this.#fromEnd = 0;
	}

	toStart(): void {
		this.#fromEnd = Math.max(0, this.#total - this.#height);
	}
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}
