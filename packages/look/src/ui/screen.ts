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
	/** A line of what you type, with the skills it names colored. */
	decorate(line: string): string;
	/** True when a skills feature expands `/skill:` references. */
	skills(): boolean;
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
