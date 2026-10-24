// Another session over the whole screen: its transcript, then an editor box whose edges say its
// folder, model and context as yours do, all inside one frame. A source that only reads, such as a
// session file, has a line in place of the editor. See docs/remote.md, "The view".
import { entryFrame, type SessionSnapshot, type SessionSource } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Key,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { emptySnapshot, type Snapshot } from "../data/snapshot.ts";
import type { Piece } from "../render/fit.ts";
import { BOXES, border } from "../render/frame.ts";
import { type Screen, type SlotName, slotPieces } from "../ui/screen.ts";
import { ViewState, Viewport } from "./state.ts";
import { transcriptOf } from "./transcript.ts";

/** Rows the frame, the blank row over the editor box and the box take from the screen. */
const CHROME = 6;
const READ_ONLY = "Read only: write to this session through a room.";

export interface ViewOptions {
	tui: TUI;
	theme: Theme;
	/** Your screen, whose slots and glyphs the view's editor box is drawn with. */
	screen: Screen;
	source: SessionSource;
	close(): void;
}

export class SessionView implements Component, Focusable {
	focused = false;
	readonly #options: ViewOptions;
	readonly #state = new ViewState();
	readonly #viewport = new Viewport();
	readonly #stop: () => void;
	/** The transcript's lines, drawn again only when the session or the width changed. */
	#drawn: { version: number; width: number; lines: string[] } | undefined;

	constructor(options: ViewOptions) {
		this.#options = options;
		this.#stop = options.source.follow(undefined, (item) => {
			if (this.#state.apply(item)) options.tui.requestRender();
		});
	}

	/** Stops following the source. */
	dispose(): void {
		this.#stop();
	}

	invalidate(): void {
		this.#drawn = undefined;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.alt("g")))
			return this.#options.close();
		if (matchesKey(data, Key.up)) this.#viewport.scroll(-1);
		else if (matchesKey(data, Key.down)) this.#viewport.scroll(1);
		else if (matchesKey(data, Key.pageUp)) this.#viewport.page(-1);
		else if (matchesKey(data, Key.pageDown)) this.#viewport.page(1);
		else if (matchesKey(data, Key.home)) this.#viewport.toStart();
		else if (matchesKey(data, Key.end)) this.#viewport.toEnd();
		else return;
		this.#options.tui.requestRender();
	}

	render(width: number): string[] {
		const { theme, tui } = this.#options;
		const inner = Math.max(1, width - 4);
		const height = Math.max(1, tui.terminal.rows - CHROME);
		const lines = this.#transcript(inner);
		const { start, end } = this.#viewport.window(lines.length, height);
		const shown = lines.slice(start, end);
		const body = [...Array.from({ length: height - shown.length }, () => ""), ...shown];
		const snapshot = this.#state.snapshot;
		const ended = this.#state.ended;
		// A blank row sets the editor box apart from the transcript, as it is under your own.
		return entryFrame([...body, "", ...this.#editor(inner, snapshot)], width, theme, {
			top: titleOf(snapshot),
			topRight: theme.fg(ended ? "dim" : "success", ended ? "ended" : "live"),
			bottom: `${theme.fg("dim", "alt+g")} back`,
			bottomRight: this.#viewport.following
				? undefined
				: theme.fg("dim", `${lines.length - end} more below`),
			color: "accent",
			dashed: ended,
		});
	}

	#transcript(width: number): string[] {
		const state = this.#state;
		if (this.#drawn?.version === state.version && this.#drawn.width === width)
			return this.#drawn.lines;
		const components = transcriptOf(state.entries, state.snapshot?.leafId, {
			tui: this.#options.tui,
			cwd: state.snapshot?.cwd ?? "",
			expanded: false,
		});
		const lines = components.flatMap((component) => component.render(width));
		this.#drawn = { version: state.version, width, lines };
		return lines;
	}

	/** The editor box, with your slots filled from the viewed session. */
	#editor(width: number, session: SessionSnapshot | undefined): string[] {
		const { screen, theme } = this.#options;
		const style = screen.frameStyle();
		const box = BOXES[style === "off" ? "rounded" : style];
		const paint = screen.paint((text) => theme.fg("border", text));
		const snapshot = lookSnapshot(screen.snapshot(), session);
		const pieces = (name: SlotName): Piece[] => slotPieces(screen, name, snapshot, paint);
		const options = {
			box,
			paint: paint.frame,
			separator: paint.dim(screen.separator()),
			ellipsis: screen.glyphs().ellipsis,
		};
		const line = truncateToWidth(theme.fg("dim", READ_ONLY), width - 4, "");
		const fill = " ".repeat(Math.max(0, width - 4 - visibleWidth(line)));
		return [
			border(width, pieces("topLeft"), pieces("topRight"), { ...options, edge: "top" }),
			`${paint.frame(box.vertical)} ${line}${fill} ${paint.frame(box.vertical)}`,
			border(width, pieces("bottomLeft"), pieces("bottomRight"), { ...options, edge: "bottom" }),
		];
	}
}

/** The viewed session's title and machine, or its id until its file says more. */
function titleOf(snapshot: SessionSnapshot | undefined): string {
	if (snapshot === undefined) return "Opening the session";
	// With no title yet, the name a room gives a session it has no handle for.
	const name = snapshot.name ?? `new-${snapshot.session.slice(-4)}`;
	return `${name} @ ${snapshot.machine}`;
}

/**
 * What your slots read, filled from the viewed session. What it does not publish, such as its git
 * state, its account and its costs, stays empty, so those segments draw nothing.
 */
export function lookSnapshot(yours: Snapshot, session: SessionSnapshot | undefined): Snapshot {
	if (session === undefined) return { ...emptySnapshot(), now: yours.now, home: yours.home };
	const window = session.context?.window;
	return {
		...emptySnapshot(),
		now: yours.now,
		home: yours.home,
		cwd: session.cwd,
		host: session.machine,
		sessionName: session.name,
		model:
			session.model === undefined
				? undefined
				: { name: session.model.id, provider: session.model.provider, reasoning: false },
		thinking: session.thinkingLevel,
		context:
			session.context === undefined || window === undefined
				? undefined
				: {
						tokens: session.context.tokens,
						window,
						percent: (session.context.tokens / window) * 100,
					},
	};
}
