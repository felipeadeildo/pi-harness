import type { Theme } from "@earendil-works/pi-coding-agent";

import type { UsageWindow } from "../usage/types.ts";

const NAME_WIDTH = 4;
const PERCENT_WIDTH = 4;
const RESET_WIDTH = 13;

function quotaTone(used: number): "success" | "warning" | "error" {
	if (used >= 90) return "error";
	if (used >= 70) return "warning";
	return "success";
}

/** `5h    62% resets in 2h `. */
function quotaWindow(theme: Theme, window: UsageWindow): string {
	const percent = theme.bold(
		theme.fg(quotaTone(window.used), `${window.used}%`.padStart(PERCENT_WIDTH)),
	);
	const reset = (window.resetsIn === undefined ? "" : `resets in ${window.resetsIn}`).padEnd(
		RESET_WIDTH,
	);
	return `${theme.fg("muted", window.name.padEnd(NAME_WIDTH))} ${percent} ${theme.fg("muted", reset)}`;
}

export function quotaWindows(theme: Theme, windows: readonly UsageWindow[]): string {
	return windows.map((window) => quotaWindow(theme, window)).join("   ");
}
