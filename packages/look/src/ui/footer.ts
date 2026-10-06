import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { fitLine, fitRegions, type Piece } from "../render/fit.ts";
import type { Paint } from "../render/paint.ts";
import { type Screen, type SlotName, slotPieces } from "./screen.ts";

const GAP = 3;
/** Room reserved for the strip, so its changing width never moves the right side between lines. */
const STRIP_ROOM = 56;

export function indentOf(screen: Screen): number {
	const style = screen.frameStyle();
	return style === "off" || style === "line" ? 1 : 2;
}

export class StripComponent implements Component {
	readonly #screen: Screen;

	constructor(screen: Screen) {
		this.#screen = screen;
	}

	render(width: number): string[] {
		const screen = this.#screen;
		const indent = indentOf(screen);
		const room = width - indent * 2;
		const pad = (line: string) => (line === "" ? "" : `${" ".repeat(indent)}${line}`);
		const right = slotPieces(screen, "stripRight", screen.snapshot(), screen.paint());
		// Always one line, so the editor does not jump when the first answer arrives.
		if (right.length === 0 || room <= 0) return [pad(renderSlot(screen, "strip", room))];

		const full = fitLine(right, Number.MAX_SAFE_INTEGER, fitOptions(screen, screen.paint()));
		const beside = room - visibleWidth(full) - GAP;
		// Beside the strip, the right side stays whole and the strip gives way.
		if (beside >= STRIP_ROOM) {
			const left = renderSlot(screen, "strip", beside);
			const gap = " ".repeat(Math.max(GAP, room - visibleWidth(left) - visibleWidth(full)));
			return [pad(`${left}${gap}${full}`)];
		}
		return [pad(renderSlot(screen, "strip", room)), pad(renderSlot(screen, "stripRight", room))];
	}

	invalidate(): void {}
}

export interface FooterHooks {
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
		lines.push(spread(screen, "below", "belowRight", room));

		const kept = lines.filter((line) => line !== "").map((line) => `${pad}${line}`);
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
