// What the components read. The feature implements it over the live session and the settings; tests
// implement it over a fixed snapshot. Everything is read at render time, so a setting or theme change
// shows on the next frame with nothing to invalidate.
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
	/** Paints with the active theme. `frame` overrides the border colour, which the editor owns. */
	paint(frame?: (text: string) => string): Paint;
	separator(): string;
	options(): SegmentOptions;
	slot(name: SlotName): readonly SegmentId[];
	frameStyle(): FrameStyle | "off";
	prompt(): boolean;
	cursor(): CursorStyle;
}

/** The rendered pieces of one slot. The separator is painted here, once, for everyone. */
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
