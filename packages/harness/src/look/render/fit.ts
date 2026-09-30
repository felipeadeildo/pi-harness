// Making pieces fit. Every piece has a priority and may have a shorter form. When a line is too wide,
// the least important pieces shorten first, then leave, one at a time, until it fits. Regions that
// share a line (the left and right of a border) compete for the same width, so an unimportant piece on
// the right leaves before an important one on the left.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface Piece {
	text: string;
	/** A shorter form, used before the piece is dropped. */
	compact?: string | undefined;
	/** Higher stays longer. */
	priority: number;
}

export interface FitOptions {
	separator: string;
	/** Width a region costs on top of its pieces when it has any, like the padding around it. */
	regionOverhead?: number;
	ellipsis?: string;
}

interface Slot {
	region: number;
	order: number;
	piece: Piece;
	text: string;
	dropped: boolean;
}

/** One string per region, each the kept pieces joined by the separator. */
export function fitRegions(
	regions: readonly (readonly Piece[])[],
	width: number,
	options: FitOptions,
): string[] {
	const slots: Slot[] = regions.flatMap((pieces, region) =>
		pieces.map((piece, order) => ({ region, order, piece, text: piece.text, dropped: false })),
	);
	const byPriority = slots.toSorted((a, b) => a.piece.priority - b.piece.priority);
	const measure = (): number => measureRegions(regions.length, slots, options);

	for (const slot of byPriority) {
		if (measure() <= width) break;
		if (slot.piece.compact !== undefined) slot.text = slot.piece.compact;
	}

	for (const slot of byPriority) {
		if (measure() <= width) break;
		if (slots.filter((candidate) => !candidate.dropped).length <= 1) break;
		slot.dropped = true;
	}

	const joined = join(regions.length, slots, options.separator);
	if (measure() <= width) return joined;

	// One piece left and still too wide: cut it, keeping the overhead of its region.
	const overhead = options.regionOverhead ?? 0;
	return joined.map((text) =>
		text === ""
			? ""
			: truncateToWidth(text, Math.max(0, width - overhead), options.ellipsis ?? "…"),
	);
}

/** A single run of pieces, as one string. */
export function fitLine(pieces: readonly Piece[], width: number, options: FitOptions): string {
	return fitRegions([pieces], width, options)[0] ?? "";
}

function join(count: number, slots: readonly Slot[], separator: string): string[] {
	const regions: string[][] = Array.from({ length: count }, () => []);
	for (const slot of slots.toSorted((a, b) => a.order - b.order)) {
		if (!slot.dropped) regions[slot.region]?.push(slot.text);
	}
	return regions.map((texts) => texts.join(separator));
}

function measureRegions(count: number, slots: readonly Slot[], options: FitOptions): number {
	const separatorWidth = visibleWidth(options.separator);
	let total = 0;
	for (let region = 0; region < count; region++) {
		const kept = slots.filter((slot) => slot.region === region && !slot.dropped);
		if (kept.length === 0) continue;
		total += options.regionOverhead ?? 0;
		total += kept.reduce((sum, slot) => sum + visibleWidth(slot.text), 0);
		total += separatorWidth * (kept.length - 1);
	}
	return total;
}
