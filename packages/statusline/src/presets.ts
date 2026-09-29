// Which pieces a preset shows, line by line, and the order groups leave in when the terminal is
// narrow. The last one to go is the model, because a line without it does not say who is doing the
// work.
import type { SegmentId } from "./segments.ts";
import type { StatuslinePreset } from "./settings.ts";

export interface Group {
	id: string;
	segments: readonly SegmentId[];
}

export interface Preset {
	/** One entry per line, each a list of groups. */
	lines: readonly (readonly Group[])[];
	/** First to leave first. */
	cutOrder: readonly string[];
}

const where: Group = { id: "where", segments: ["path", "git", "session"] };
const model: Group = { id: "model", segments: ["model", "thinking"] };
const rate: Group = { id: "rate", segments: ["rate", "ttft"] };
const spend: Group = { id: "spend", segments: ["tokens", "cache", "cost"] };
const context: Group = { id: "context", segments: ["context"] };

export const PRESETS: Record<StatuslinePreset, Preset> = {
	full: {
		lines: [
			[
				where,
				{ id: "host", segments: ["host", "version"] },
				{ id: "working", segments: ["working"] },
				context,
			],
			[{ id: "who", segments: ["provider"] }, model, rate, spend],
			[{ id: "statuses", segments: ["statuses"] }],
		],
		cutOrder: [
			"statuses",
			"version",
			"host",
			"working",
			"where",
			"spend",
			"context",
			"rate",
			"who",
			"model",
		],
	},
	compact: {
		lines: [
			[where, model, rate, { id: "spend", segments: ["cost"] }, context],
			[{ id: "statuses", segments: ["statuses"] }],
		],
		cutOrder: ["statuses", "where", "rate", "context", "model"],
	},
	minimal: {
		lines: [[where, model, context], [{ id: "statuses", segments: ["statuses"] }]],
		cutOrder: ["statuses", "where", "context", "model"],
	},
};
