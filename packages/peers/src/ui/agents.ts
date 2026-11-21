import { GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

import type { Peer } from "../folder.ts";
import { spin } from "./motion.ts";

export function markOf(peer: Peer, color: ThemeColor, theme: Theme, now: number): string {
	return peer.state === "running"
		? theme.fg(color, spin(now))
		: theme.fg("dim", GLYPH.diamondEmpty);
}
