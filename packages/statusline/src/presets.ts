// Which pieces a preset shows, line by line, and the order groups leave in when the terminal is
// narrow. The first line is the answer being written right now. The last group to leave is the
// model, because a line without it does not say who is doing the work.
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

const turn: Group = {
	id: "turn",
	segments: ["rate", "ttft", "turn", "turnTokens", "turnOut", "costRate"],
};
const where: Group = { id: "where", segments: ["path", "git", "session"] };
const who: Group = { id: "who", segments: ["provider"] };
const model: Group = { id: "model", segments: ["model", "thinking"] };
const rate: Group = { id: "rate", segments: ["rate", "ttft"] };
const spend: Group = { id: "spend", segments: ["tokens", "cache", "cost", "sessionTps"] };
const cost: Group = { id: "cost", segments: ["cost"] };
const context: Group = { id: "context", segments: ["context"] };
const statuses: Group = { id: "statuses", segments: ["statuses"] };

export const PRESETS: Record<StatuslinePreset, Preset> = {
	full: {
		lines: [
			[turn],
			[where, { id: "host", segments: ["host", "version"] }, context],
			[who, model, spend],
			[statuses],
		],
		cutOrder: [
			"statuses",
			"version",
			"host",
			"turn",
			"where",
			"spend",
			"context",
			"rate",
			"who",
			"model",
		],
	},
	compact: {
		lines: [[turn], [where, model, rate, cost, context], [statuses]],
		cutOrder: ["statuses", "turn", "where", "rate", "context", "model"],
	},
	minimal: {
		lines: [[where, model, context], [statuses]],
		cutOrder: ["statuses", "where", "context", "model"],
	},
};
