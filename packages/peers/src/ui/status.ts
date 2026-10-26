import { GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

import type { BoardMark } from "../here.ts";

/** For RPC clients and the remote bridge. */
export function statusLine(
	summary: { others: BoardMark[]; unread: number },
	theme: Theme,
): string | undefined {
	const marks = summary.others.map((one) => theme.fg(one.color as ThemeColor, MARKS[one.state]));
	if (summary.unread > 0) marks.push(theme.fg("warning", `@${summary.unread}`));
	return marks.length === 0 ? undefined : marks.join(" ");
}

export const PEERS_STATUS = "pi-peers";

/** Filled when running, hollow when idle, so it reads with colour off. */
const MARKS: Record<BoardMark["state"], string> = {
	running: GLYPH.diamond,
	idle: GLYPH.diamondEmpty,
	waiting: GLYPH.flag,
};
