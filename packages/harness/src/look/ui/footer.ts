// The lines around the editor that are not the frame. The strip above it is the answer being written;
// the footer below it is the session. With the frame off, the footer also carries the four frame
// slots, so turning the box off never hides data.
import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { fitLine, fitRegions, type Piece } from "../render/fit.ts";
import type { Paint } from "../render/paint.ts";
import { type Screen, type SlotName, slotPieces } from "./screen.ts";

/** At least this much between a left and a right group sharing a line. */
const GAP = 3;

/** Where the text starts, so the strip and the footer line up with the text inside the frame. */
export function indentOf(screen: Screen): number {
	const style = screen.frameStyle();
	return style === "off" || style === "line" ? 1 : 2;
}

/** The strip above the editor. Blank until the first answer, but its line is always there. */
export class StripComponent implements Component {
	readonly #screen: Screen;

	constructor(screen: Screen) {
		this.#screen = screen;
	}

	render(width: number): string[] {
		const indent = indentOf(this.#screen);
		const line = renderSlot(this.#screen, "strip", width - indent * 2);
		// Always one line, empty or not: a strip that appears with the first answer moves the editor.
		return [line === "" ? "" : `${" ".repeat(indent)}${line}`];
	}

	invalidate(): void {}
}

export interface FooterHooks {
	/** The footer data is where the branch and other packages' statuses come from. */
	attach(data: ReadonlyFooterDataProvider, repaint: () => void): void;
	detach(): void;
}

export class FooterComponent implements Component {
	readonly #screen: Screen;
	readonly #hooks: FooterHooks;
	readonly #stopWatching: () => void;

	constructor(tui: TUI, data: ReadonlyFooterDataProvider, screen: Screen, hooks: FooterHooks) {
		this.#screen = screen;
		this.#hooks = hooks;
		hooks.attach(data, () => tui.requestRender());
		this.#stopWatching = data.onBranchChange(() => tui.requestRender());
	}

	render(width: number): string[] {
		const screen = this.#screen;
		const indent = indentOf(screen);
		const room = width - indent * 2;
		const pad = " ".repeat(indent);
		const lines: string[] = [];

		if (screen.frameStyle() === "off") {
			lines.push(spread(screen, "topLeft", "topRight", room));
			lines.push(spread(screen, "bottomLeft", "bottomRight", room));
		}
		lines.push(renderSlot(screen, "below", room));

		const kept = lines.filter((line) => line !== "").map((line) => `${pad}${line}`);
		// At least one line, for the same reason as the strip: the editor must not jump when it fills.
		return kept.length === 0 ? [""] : kept;
	}

	invalidate(): void {}

	dispose(): void {
		this.#stopWatching();
		this.#hooks.detach();
	}
}

function renderSlot(screen: Screen, name: SlotName, width: number): string {
	if (width <= 0) return "";
	const paint = screen.paint();
	const pieces = slotPieces(screen, name, screen.snapshot(), paint);
	return fitLine(pieces, width, fitOptions(screen, paint));
}

/** A left group and a right group on one line, pushed apart. */
function spread(screen: Screen, leftSlot: SlotName, rightSlot: SlotName, width: number): string {
	if (width <= 0) return "";
	const paint = screen.paint();
	const snapshot = screen.snapshot();
	const left: Piece[] = slotPieces(screen, leftSlot, snapshot, paint);
	const right: Piece[] = slotPieces(screen, rightSlot, snapshot, paint);
	const [l = "", r = ""] = fitRegions([left, right], width - GAP, fitOptions(screen, paint));
	if (r === "") return l;
	return `${l}${" ".repeat(Math.max(GAP, width - visibleWidth(l) - visibleWidth(r)))}${r}`;
}

function fitOptions(screen: Screen, paint: Paint) {
	return { separator: paint.dim(screen.separator()), ellipsis: screen.glyphs().ellipsis };
}
