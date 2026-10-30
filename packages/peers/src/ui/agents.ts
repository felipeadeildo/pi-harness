import { CUT, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { doing, stateOf, waiting } from "../cards.ts";
import type { Peer } from "../folder.ts";
import { spin } from "./motion.ts";

export const MARKS = { idle: GLYPH.diamondEmpty, waiting: GLYPH.flag } as const;

export function markOf(peer: Peer, color: ThemeColor, theme: Theme, now: number): string {
	switch (stateOf(peer)) {
		case "waiting":
			return theme.fg("warning", MARKS.waiting);
		case "running":
			return theme.fg(color, spin(now));
		case "idle":
			return theme.fg("dim", MARKS.idle);
	}
}

/** What it waits on you for, else what it is doing. */
export function glance(peer: Peer, theme: Theme, width: number): string | undefined {
	const waits = waiting(peer)[0];
	const first = waits ?? doing(peer)[0];
	if (first === undefined) return undefined;
	const text = waits === undefined ? first.title : `waits on you: ${first.title}`;
	return theme.fg(waits === undefined ? "muted" : "warning", truncateToWidth(text, width, CUT));
}
