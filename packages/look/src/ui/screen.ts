import type { Snapshot } from "../data/snapshot.ts";
import type { Piece } from "../render/fit.ts";
import type { FrameStyle } from "../render/frame.ts";
import type { Glyphs } from "../render/glyphs.ts";
import type { Paint } from "../render/paint.ts";
import { renderSegments, type SegmentId, type SegmentOptions } from "../render/segments.ts";
import type { CursorStyle } from "../settings.ts";

export type SlotName = "strip" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight" | "below";

export interface Screen {
	snapshot(): Snapshot;
	glyphs(): Glyphs;
	paint(frame?: (text: string) => string): Paint;
	separator(): string;
	options(): SegmentOptions;
	slot(name: SlotName): readonly SegmentId[];
	frameStyle(): FrameStyle | "off";
	cursor(): CursorStyle;
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
