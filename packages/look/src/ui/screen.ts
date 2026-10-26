import type { Snapshot } from "../data/snapshot.ts";
import type { Piece } from "../render/fit.ts";
import type { FrameStyle } from "../render/frame.ts";
import type { Glyphs } from "../render/glyphs.ts";
import type { Paint } from "../render/paint.ts";
import { renderSegments, type SegmentId, type SegmentOptions } from "../render/segments.ts";
import type { CursorStyle } from "../settings.ts";

export type SlotName =
	| "strip"
	| "stripRight"
	| "topLeft"
	| "topRight"
	| "bottomLeft"
	| "bottomRight"
	| "below"
	| "belowRight";

export interface Screen {
	snapshot(): Snapshot;
	glyphs(): Glyphs;
	paint(frame?: (text: string) => string): Paint;
	separator(): string;
	options(): SegmentOptions;
	slot(name: SlotName): readonly SegmentId[];
	frameStyle(): FrameStyle | "off";
	cursor(): CursorStyle;
	decorate(line: string): string;
	skills(): boolean;
	/** Compared by anything that keeps a drawing, so a change does not wait for the next keystroke. */
	revision(): number;
	bump(): void;
}

export function slotPieces(
	screen: Screen,
	name: SlotName,
	snapshot: Snapshot,
	paint: Paint,
): Piece[] {
	return renderSegments(screen.slot(name), {
		snapshot,
		glyphs: screen.glyphs(),
		paint,
		options: screen.options(),
	});
}
