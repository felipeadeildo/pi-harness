// Building the lines. A segment renders to a string or to nothing, and segments that belong together
// sit in one group. Groups are joined by the group separator and the pieces inside a group by the item
// separator. When the terminal is too narrow, the groups leave in the order the preset gives, and a
// group that leaves takes its separator with it.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface Separators {
	/** Between groups, like the box drawing pi already uses for its own frames. */
	group: string;
	/** Between the pieces of one group. */
	item: string;
}

export const SEPARATORS: Record<SeparatorStyle, Separators> = {
	bar: { group: "│", item: "·" },
	dot: { group: "·", item: "·" },
	slash: { group: "/", item: "·" },
};

export type SeparatorStyle = "bar" | "dot" | "slash";

export interface Group {
	id: string;
	/** What each piece renders to. A piece with nothing to say renders to undefined. */
	parts: (string | undefined)[];
}

export interface LineOptions {
	separators: Separators;
	/** The order groups leave when the width runs out, first to go first. */
	cutOrder: readonly string[];
	/** Paint the separators. Defaults to leaving them as they are. */
	dim?: (text: string) => string;
}

/** One string per line that has something to say. */
export function renderLines(
	lines: readonly (readonly Group[])[],
	width: number,
	options: LineOptions,
): string[] {
	return lines.flatMap((groups) => {
		const line = renderLine(groups, width, options);
		return line === undefined ? [] : [line];
	});
}

export function renderLine(
	groups: readonly Group[],
	width: number,
	options: LineOptions,
): string | undefined {
	const kept = groups.filter((group) => group.parts.some((part) => part !== undefined));
	const dim = options.dim ?? ((text: string) => text);

	for (const id of options.cutOrder) {
		// The last group stays even when it does not fit, and is cut instead. An empty footer says
		// less than a shortened model name.
		if (kept.length <= 1) break;
		if (visibleWidth(compose(kept, options.separators, dim)) <= width) break;
		const index = kept.findIndex((group) => group.id === id);
		if (index !== -1) kept.splice(index, 1);
	}

	if (kept.length === 0) return undefined;
	return truncateToWidth(compose(kept, options.separators, dim), width, dim("…"));
}

function compose(
	groups: readonly Group[],
	separators: Separators,
	dim: (text: string) => string,
): string {
	const rendered = groups.map((group) => {
		const parts = group.parts.filter((part): part is string => part !== undefined);
		return parts.join(` ${dim(separators.item)} `);
	});
	return rendered.join(` ${dim(separators.group)} `);
}
