// A plan's windows as every dialog of this package draws them, in fixed columns so rows line up.
import type { Theme } from "@earendil-works/pi-coding-agent";

import type { UsageWindow } from "../usage/types.ts";

const NAME_WIDTH = 4;
const PERCENT_WIDTH = 4;
const RESET_WIDTH = 13;

/** The color a window's usage reads in: healthy, getting full, or spent. */
export function quotaTone(used: number): "success" | "warning" | "error" {
	if (used >= 90) return "error";
	if (used >= 70) return "warning";
	return "success";
}

/** One window: `5h    62% resets in 2h `. */
export function quotaWindow(theme: Theme, window: UsageWindow): string {
	const percent = theme.bold(
		theme.fg(quotaTone(window.used), `${window.used}%`.padStart(PERCENT_WIDTH)),
	);
	const reset = (window.resetsIn === undefined ? "" : `resets in ${window.resetsIn}`).padEnd(
		RESET_WIDTH,
	);
	return `${theme.fg("muted", window.name.padEnd(NAME_WIDTH))} ${percent} ${theme.fg("muted", reset)}`;
}

/** Every window of a plan, side by side. */
export function quotaWindows(theme: Theme, windows: readonly UsageWindow[]): string {
	return windows.map((window) => quotaWindow(theme, window)).join("   ");
}
