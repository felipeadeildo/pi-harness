// One line, so the reader knows where they are and what it costs without asking.
import { boolean, integer, literal, setting } from "@adeildo/pi-kit";

import type { SeparatorStyle } from "./line.ts";

const GROUP = "Statusline";

export type StatuslinePreset = "full" | "compact" | "minimal";

export const preset = setting<StatuslinePreset>({
	id: "statusline.preset",
	default: "full",
	decoder: literal("full", "compact", "minimal"),
	project: true,
	ui: {
		group: GROUP,
		label: "Preset",
		description: "How much of the line to keep when the terminal is narrow.",
	},
});

export const separator = setting<SeparatorStyle>({
	id: "statusline.separator",
	default: "bar",
	decoder: literal("bar", "dot", "slash"),
	project: true,
	ui: {
		group: GROUP,
		label: "Separator",
		description: "Bar draws a box character between groups, the way pi frames its own panels.",
	},
});

export const pathLength = setting({
	id: "statusline.pathLength",
	default: 40,
	decoder: integer(0, 500),
	project: true,
	ui: {
		group: GROUP,
		label: "Path length",
		description:
			"Longest the folder may take before it is shortened from the left. 0 keeps all of it.",
	},
});

export const statuses = setting({
	id: "statusline.statuses",
	default: true,
	decoder: boolean,
	project: true,
	ui: {
		group: GROUP,
		label: "Other packages",
		description: "Show what the other extensions report through setStatus.",
	},
});

export const gauge = setting({
	id: "statusline.gauge",
	default: true,
	decoder: boolean,
	project: true,
	ui: {
		group: GROUP,
		label: "Context gauge",
		description: "Draw the context as a bar next to the percentage.",
	},
});

export const icons = setting({
	id: "statusline.icons",
	default: false,
	decoder: boolean,
	project: true,
	ui: {
		group: GROUP,
		label: "Icons",
		description:
			"A glyph before some of the pieces, for a font that has them. Off, everything is a word.",
	},
});

export const STATUSLINE_SETTINGS = [preset, separator, pathLength, statuses, gauge, icons];
