// What each piece of the line says. Every segment is a pure function of the session, so the lines can
// be built and tested without a terminal.
import { isAbsolute, relative, resolve, sep } from "node:path";

import { VERSION } from "@earendil-works/pi-coding-agent";

import type { Totals } from "./totals.ts";

export type SegmentId =
	| "path"
	| "git"
	| "host"
	| "version"
	| "session"
	| "working"
	| "provider"
	| "model"
	| "thinking"
	| "rate"
	| "ttft"
	| "tokens"
	| "cache"
	| "cost"
	| "context"
	| "statuses";

export interface SessionData {
	cwd: string;
	home: string | undefined;
	/** From the footer data, not from the session. */
	branch: string | null;
	/** Short host name, so a line pasted into a chat still says which machine it came from. */
	host: string | undefined;
	sessionName: string | undefined;
	model: { id: string; name: string; provider: string; reasoning: boolean } | undefined;
	thinking: string | undefined;
	context: { percent: number; tokens: number; contextWindow: number } | undefined;
	totals: Totals;
	cacheHit: number | undefined;
	/** Tokens per second over the last answer, measured from the first piece to the end. */
	rate: number | undefined;
	firstTokenMs: number | undefined;
	/** How long the answer running right now has been going, or the last one took. */
	workingMs: number | undefined;
	statuses: readonly string[];
	/** A subscription account, where the dollar figure is what it would have cost. */
	subscription: boolean;
}

export interface SegmentOptions {
	pathLength: number;
	statuses: boolean;
	gauge: boolean;
	/** A glyph before some of the pieces, for a font that has them. */
	icons: boolean;
}

export interface Paint {
	/** Separators, units and labels sit back, so the data reads first. */
	dim(text: string): string;
	/** The context gauge turns warm as it fills. */
	context(percent: number, text: string): string;
}

/** Used by tests and by anything rendering without a theme. */
export const PLAIN: Paint = { dim: (text) => text, context: (_percent, text) => text };

export type Part = string | undefined;

const GAUGE_CELLS = 8;

const ICON = {
	host: "@",
	working: "◷",
	provider: "⬡",
	thinking: "✦",
	rate: "⚡",
	ttft: "⏱",
	cache: "≋",
	tokens: "◇",
	version: "●",
};

type Renderer = (data: SessionData, options: SegmentOptions, paint: Paint) => Part | Part[];

const SEGMENTS: Record<SegmentId, Renderer> = {
	path: (data, options) => shortenPath(data.cwd, data.home, options.pathLength),
	git: (data) => data.branch ?? undefined,
	host: (data, options, paint) =>
		data.host === undefined ? undefined : withGlyph(options, "host", data.host, paint),
	version: (_data, options, paint) => withGlyph(options, "version", `v${VERSION}`, paint),
	session: (data) => data.sessionName,
	working: (data, options, paint) =>
		data.workingMs === undefined
			? undefined
			: withGlyph(options, "working", duration(data.workingMs), paint),
	provider: (data, options, paint) =>
		data.model === undefined
			? undefined
			: withGlyph(options, "provider", data.model.provider, paint),
	model: (data) => data.model?.name,
	thinking: (data, options, paint) =>
		data.thinking === undefined ? undefined : withGlyph(options, "thinking", data.thinking, paint),
	rate: (data, options, paint) =>
		data.rate === undefined
			? undefined
			: withGlyph(options, "rate", `${Math.round(data.rate)} tok/s`, paint),
	ttft: (data, options, paint) =>
		data.firstTokenMs === undefined
			? undefined
			: withGlyph(options, "ttft", shortSeconds(data.firstTokenMs), paint),
	tokens: (data, options, paint) => {
		const parts: Part[] = [];
		if (data.totals.input > 0) parts.push(`${paint.dim("↑")}${count(data.totals.input)}`);
		if (data.totals.output > 0) parts.push(`${paint.dim("↓")}${count(data.totals.output)}`);
		if (data.totals.cacheRead > 0) parts.push(`${paint.dim("R")}${count(data.totals.cacheRead)}`);
		if (data.totals.cacheWrite > 0) parts.push(`${paint.dim("W")}${count(data.totals.cacheWrite)}`);
		return parts.length === 0 ? undefined : parts;
	},
	cache: (data, options, paint) =>
		data.cacheHit === undefined
			? undefined
			: `${paint.dim(withGlyphText(options, "cache", "cache"))} ${data.cacheHit.toFixed(1)}%`,
	cost: (data) => {
		if (data.totals.cost === 0 && !data.subscription) return undefined;
		return `$${data.totals.cost.toFixed(3)}${data.subscription ? " (sub)" : ""}`;
	},
	context: (data, options, paint) => {
		if (!data.context) return undefined;
		const { percent, tokens, contextWindow } = data.context;
		const gauge = options.gauge ? ` ${gaugeBar(percent)}` : "";
		const window = ` ${count(tokens)}/${count(contextWindow)}`;
		return paint.context(percent, `${percent.toFixed(1)}%${gauge}${paint.dim(window)}`);
	},
	statuses: (data, options, paint) =>
		options.statuses ? data.statuses.map((text) => paint.dim(text)) : undefined,
};

export function renderParts(
	segments: readonly SegmentId[],
	data: SessionData,
	options: SegmentOptions,
	paint: Paint,
): Part[] {
	return segments.flatMap((id) => {
		const rendered = SEGMENTS[id](data, options, paint);
		return Array.isArray(rendered) ? rendered : [rendered];
	});
}

export function emptyData(): SessionData {
	return {
		cwd: "",
		home: undefined,
		branch: null,
		host: undefined,
		sessionName: undefined,
		model: undefined,
		thinking: undefined,
		context: undefined,
		totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		cacheHit: undefined,
		rate: undefined,
		firstTokenMs: undefined,
		workingMs: undefined,
		statuses: [],
		subscription: false,
	};
}

/** The value, with a glyph in front when the font has one. */
function withGlyph(
	options: SegmentOptions,
	name: keyof typeof ICON,
	text: string,
	paint: Paint,
): string {
	return options.icons ? paint.dim(ICON[name]) + " " + text : text;
}

/** The same, for a label the segment carries itself, like the word `cache`. */
function withGlyphText(options: SegmentOptions, name: keyof typeof ICON, text: string): string {
	return options.icons ? `${ICON[name]} ${text}` : text;
}

/** `~` for the home folder, and a leading ellipsis when the tail is all that fits. */
export function shortenPath(cwd: string, home: string | undefined, maxLength: number): string {
	const full = home === undefined ? cwd : underHome(cwd, home);
	if (maxLength <= 0 || full.length <= maxLength) return full;
	return `…${full.slice(full.length - maxLength + 1)}`;
}

function underHome(cwd: string, home: string): string {
	const rest = relative(resolve(home), resolve(cwd));
	const inside =
		rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
	if (!inside) return cwd;
	return rest === "" ? "~" : `~${sep}${rest}`;
}

/** Pi reports whole thousands as `1.2k` and millions as `1.2M`. */
export function count(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
	if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function gaugeBar(percent: number): string {
	const filled = Math.max(0, Math.min(GAUGE_CELLS, Math.round((percent / 100) * GAUGE_CELLS)));
	return "▓".repeat(filled) + "░".repeat(GAUGE_CELLS - filled);
}

/** `2m 17s`, or `1h 4m`, for how long something has been running. */
export function duration(milliseconds: number): string {
	const total = Math.max(0, Math.round(milliseconds / 1000));
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function shortSeconds(milliseconds: number): string {
	return milliseconds < 1000
		? `${Math.round(milliseconds)}ms`
		: `${(milliseconds / 1000).toFixed(1)}s`;
}
