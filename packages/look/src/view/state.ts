// What a view holds of the session it shows, folded from its source, and where its reader is
// scrolled. Kept apart from drawing so the rules a reader feels (the end followed, a place kept while
// reading back, a session that ended) are tested without a terminal.
import type { SessionSummary, SourceItem } from "@adeildo/pi-kit";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export class ViewState {
	readonly #entries: SessionEntry[] = [];
	readonly #ids = new Set<string>();
	#snapshot: SessionSummary | undefined;
	#ended = false;
	/** Bumped on every change, so a drawing can tell it is stale. */
	#version = 0;

	get entries(): readonly SessionEntry[] {
		return this.#entries;
	}

	get snapshot(): SessionSummary | undefined {
		return this.#snapshot;
	}

	get ended(): boolean {
		return this.#ended;
	}

	get version(): number {
		return this.#version;
	}

	/** The id of the last entry, the cursor to follow again from after a reconnect. */
	get last(): string | undefined {
		return this.#entries.at(-1)?.id;
	}

	/** Takes in one item from the source. False when it changed nothing. */
	apply(item: SourceItem): boolean {
		switch (item.kind) {
			case "entry":
				if (this.#ids.has(item.entry.id)) return false;
				this.#ids.add(item.entry.id);
				this.#entries.push(item.entry);
				break;
			case "snapshot":
				this.#snapshot = item.snapshot;
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

/**
 * Where a reader is in lines too many for the screen, counted from the end. At the end, it follows
 * what arrives; scrolled back, it keeps the lines it is reading where they are as more arrive below.
 */
export class Viewport {
	#fromEnd = 0;
	#total = 0;
	#height = 0;

	get following(): boolean {
		return this.#fromEnd === 0;
	}

	/** The lines to draw out of `total`, in a screen `height` rows tall: `[start, end)`. */
	window(total: number, height: number): { start: number; end: number } {
		// Lines that arrived below while scrolled back push the end away, not the reader.
		if (this.#fromEnd > 0 && total > this.#total) this.#fromEnd += total - this.#total;
		this.#total = total;
		this.#height = height;
		this.#fromEnd = clamp(this.#fromEnd, 0, Math.max(0, total - height));
		const end = total - this.#fromEnd;
		return { start: Math.max(0, end - height), end };
	}

	/** Moves by `rows`, negative toward the start. */
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
