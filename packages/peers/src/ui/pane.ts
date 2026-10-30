// What the panel's cursor points at, as messages: one agent's in a room, a room's, or a conversation.
import { formatClock, GLYPH, spread } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Here } from "../here.ts";
import { type FeedOptions, feedMoving, feedView } from "./feed.ts";

/** The newest items laid out, and how many more each scroll to the oldest adds. */
const HISTORY = 200;

export interface PaneFocus {
	key: string;
	here: Here;
	title: string;
	/** A line under the title, already painted. */
	note?: (width: number) => string | undefined;
	shows: NonNullable<FeedOptions["shows"]>;
	origin?: string;
}

export interface PaneOptions {
	theme: Theme;
	requestRender: () => void;
	now?: () => number;
	clock?: (at: number) => string;
}

export class FeedPane {
	readonly #options: PaneOptions;
	#key: string | undefined;
	#offset = 0;
	#height = 0;
	#follow = true;
	#unread = 0;
	#window = HISTORY;

	constructor(options: PaneOptions) {
		this.#options = options;
	}

	moving(focus: PaneFocus | undefined): boolean {
		if (focus === undefined) return false;
		const { here } = focus;
		if (here.othersTyping().some(focus.shows.typing)) return true;
		return feedMoving(here.folder.room, here.live(), this.#now());
	}

	scroll(lines: number): void {
		this.#offset = Math.max(0, this.#offset + lines);
		this.#follow = false;
		this.#options.requestRender();
	}

	page(step: number): void {
		this.scroll(step * Math.max(1, this.#height - 2));
	}

	lines(focus: PaneFocus | undefined, width: number, height: number): string[] {
		if (focus === undefined) return [];
		if (focus.key !== this.#key) {
			this.#key = focus.key;
			this.#follow = true;
		}
		const { theme } = this.#options;
		const { here } = focus;
		if (this.#follow) this.#window = HISTORY;
		const layout = () =>
			feedView(here.folder.room, here.othersTyping(), {
				theme,
				now: this.#now(),
				width,
				me: here.session,
				names: here.names().bySession,
				live: here.live(),
				peers: here.folder.peers,
				clock: this.#options.clock ?? formatClock,
				shows: focus.shows,
				last: this.#window,
			});
		let feed = layout();
		if (!this.#follow && this.#offset === 0 && feed.older) {
			const before = feed.lines.length;
			this.#window += HISTORY;
			feed = layout();
			this.#offset += feed.lines.length - before;
		}
		const origin =
			feed.older || focus.origin === undefined
				? []
				: [...wrapTextWithAnsi(focus.origin, width).map((line) => theme.fg("dim", line)), ""];
		const lines = [...origin, ...feed.lines];
		const heads = [
			...origin.map(() => undefined),
			...feed.heads.map((at) => (at === undefined ? undefined : at + origin.length)),
		];
		const note = focus.note?.(width);
		const top = note === undefined ? 2 : 3;
		this.#height = Math.max(1, height - top);
		this.#followFeed(lines.length);
		const shown = lines.slice(this.#offset, this.#offset + this.#height);
		const head = heads[this.#offset];
		if (head !== undefined && head < this.#offset) shown[0] = lines[head] ?? "";
		const title = spread(theme.bold(focus.title), this.#scrollHint(), width);
		return note === undefined ? [title, "", ...shown] : [title, note, "", ...shown];
	}

	#scrollHint(): string {
		const { theme } = this.#options;
		if (this.#follow) return "";
		if (this.#unread > 0) return theme.fg("accent", `${GLYPH.down} ${this.#unread} new`);
		return theme.fg("dim", `${GLYPH.up} ${this.#offset} above`);
	}

	#followFeed(total: number): void {
		const most = Math.max(0, total - this.#height);
		if (!this.#follow) {
			this.#offset = Math.min(this.#offset, most);
			this.#unread = Math.max(0, most - this.#offset);
			if (this.#offset === most) this.#follow = true;
			return;
		}
		this.#offset = most;
		this.#unread = 0;
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}
}
