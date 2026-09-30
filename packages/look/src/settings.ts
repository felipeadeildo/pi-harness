// Every setting of the look, under `look.` in the shared settings file. The slots are plain lists of
// segment ids, so moving a piece from the frame to the footer is editing one array.
import {
	boolean,
	type Decoder,
	integer,
	literal,
	pass,
	problem,
	setting,
	string,
} from "@adeildo/pi-kit";

import type { FrameStyle } from "./render/frame.ts";
import type { IconMode } from "./render/glyphs.ts";
import { isSegmentId, type SegmentId } from "./render/segments.ts";

const GROUP = "Look";

export type HeaderStyle = "card" | "compact" | "off";
export type SeparatorStyle = "dot" | "bar" | "slash" | "space";
export type CursorStyle = "block" | "bar" | "underline";

export const SEPARATORS: Record<SeparatorStyle, string> = {
	dot: " · ",
	bar: " │ ",
	slash: " / ",
	space: "  ",
};

/** A list of known segment ids. Unknown ones are dropped with a warning, not the whole list. */
function segments(fallback: readonly SegmentId[]): Decoder<SegmentId[]> {
	return {
		decode(input, path) {
			if (input === undefined) return pass([...fallback]);
			if (!Array.isArray(input))
				return pass([...fallback], [problem(path, "expected an array of segment ids")]);
			const value: SegmentId[] = [];
			const unknown: string[] = [];
			for (const entry of input) {
				if (typeof entry === "string" && isSegmentId(entry)) value.push(entry);
				else unknown.push(String(entry));
			}
			const problems =
				unknown.length === 0
					? []
					: [problem(path, `ignored unknown segments: ${unknown.join(", ")}`)];
			return pass(value, problems);
		},
	};
}

function slot(id: string, label: string, description: string, fallback: readonly SegmentId[]) {
	return setting<SegmentId[]>({
		id: `look.${id}`,
		default: [...fallback],
		decoder: segments(fallback),
		project: true,
		ui: { group: GROUP, label, description },
	});
}

export const strip = slot(
	"strip",
	"Answer strip",
	"The line above the editor: how long the agent has worked, and the last call that finished.",
	["elapsed", "last"],
);
export const topLeft = slot("frame.topLeft", "Frame, top left", "After the working spinner.", [
	"branch",
	"session",
]);
export const topRight = slot("frame.topRight", "Frame, top right", "Where you are.", [
	"path",
	"host",
]);
/** Where pi-ask-permission reports its mode. It says what happens to what you type, so it sits by the editor. */
export const PERMISSION_MODE: SegmentId = "status:pi-ask-permission:mode";

export const bottomLeft = slot(
	"frame.bottomLeft",
	"Frame, bottom left",
	"How what you type is handled, and who does the work.",
	[PERMISSION_MODE, "model", "effort"],
);
export const bottomRight = slot("frame.bottomRight", "Frame, bottom right", "How full it is.", [
	"context",
]);
export const below = slot(
	"below",
	"Below the editor",
	"The session: cost, tokens, cache, average speeds, and what other packages report, last because it changes the most.",
	["cost", "tokens", "cache", "average", "statuses"],
);

export const frame = setting<FrameStyle | "off">({
	id: "look.frame.style",
	default: "rounded",
	decoder: literal("rounded", "square", "heavy", "line", "off"),
	project: true,
	ui: {
		group: GROUP,
		label: "Frame",
		description:
			"The box around the editor. `line` keeps pi's two rules, `off` leaves the editor alone and moves the frame slots to the footer.",
	},
});

export const cursor = setting<CursorStyle>({
	id: "look.frame.cursor",
	default: "bar",
	decoder: literal("block", "bar", "underline"),
	ui: {
		group: GROUP,
		label: "Cursor",
		description: "Bar and underline use the terminal's own cursor, so it blinks the way it does.",
	},
});

export const header = setting<HeaderStyle>({
	id: "look.header",
	default: "card",
	decoder: literal("card", "compact", "off"),
	project: true,
	ui: {
		group: GROUP,
		label: "Start screen",
		description: "The card pi opens with. Off keeps pi's own.",
	},
});

export const icons = setting<IconMode>({
	id: "look.icons",
	default: "auto",
	decoder: literal("auto", "nerd", "unicode", "ascii"),
	ui: {
		group: GROUP,
		label: "Icons",
		description: "Auto uses Nerd Font glyphs locally, plain Unicode over SSH.",
	},
});

export const separator = setting<SeparatorStyle>({
	id: "look.separator",
	default: "dot",
	decoder: literal("dot", "bar", "slash", "space"),
	project: true,
	ui: { group: GROUP, label: "Separator", description: "Between the pieces of a slot." },
});

export const pathLength = setting({
	id: "look.pathLength",
	default: 40,
	decoder: integer(0, 500),
	project: true,
	ui: {
		group: GROUP,
		label: "Path length",
		description: "Longest the folder may be before it is shortened from the left. 0 keeps it all.",
	},
});

export const gaugeCells = setting({
	id: "look.gaugeCells",
	default: 8,
	decoder: integer(0, 40),
	project: true,
	ui: { group: GROUP, label: "Gauge", description: "Cells in the context gauge. 0 hides it." },
});

export const labels = setting({
	id: "look.labels",
	default: true,
	decoder: boolean,
	project: true,
	ui: {
		group: GROUP,
		label: "Labels",
		description:
			"A short word before each number (out, in, ttft, took, ctx, cache). Off is denser.",
	},
});

export const peek = setting({
	id: "look.peek",
	default: true,
	decoder: boolean,
	ui: {
		group: GROUP,
		label: "Working line",
		description:
			"The spinner says what the model is doing: the tail of its thinking, the tool it calls.",
	},
});

export const desktop = setting({
	id: "look.desktop.theme",
	default: true,
	decoder: boolean,
	ui: {
		group: GROUP,
		label: "Desktop theme",
		description:
			"Write the matugen palette from DankMaterialShell as the pi theme `desktop`, and keep it in sync.",
	},
});

export const desktopSource = setting({
	id: "look.desktop.source",
	default: "~/.cache/DankMaterialShell/dms-colors.json",
	decoder: string,
	ui: {
		group: GROUP,
		label: "Desktop palette",
		description: "The DankMaterialShell colour file the desktop theme is made from.",
	},
});

export const LOOK_SETTINGS = [
	strip,
	topLeft,
	topRight,
	bottomLeft,
	bottomRight,
	below,
	frame,
	cursor,
	header,
	icons,
	separator,
	pathLength,
	gaugeCells,
	labels,
	peek,
	desktop,
	desktopSource,
];
