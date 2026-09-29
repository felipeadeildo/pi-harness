// What each piece of the line says. Every segment is a pure function of the session, so the lines can
// be built and tested without a terminal. Each one colours itself through the Paint it is given.
import { isAbsolute, relative, resolve, sep } from "node:path";

import { VERSION } from "@earendil-works/pi-coding-agent";

import type { Totals } from "./totals.ts";

export type SegmentId =
	| "path"
	| "git"
	| "host"
	| "version"
	| "session"
	| "turn"
	| "provider"
	| "model"
	| "thinking"
	| "rate"
	| "ttft"
	| "tokens"
	| "cache"
	| "cost"
	| "costRate"
	| "turnTokens"
	| "turnOut"
	| "sessionTps"
	| "context"
	| "statuses";

export interface GitState {
	ahead: number;
	behind: number;
	/** Anything changed in the working tree. */
	dirty: boolean;
}

export interface TurnData {
	/** True while the answer is still arriving. */
	running: boolean;
	elapsedMs: number;
	usage: Totals;
}

export interface SessionData {
	cwd: string;
	home: string | undefined;
	/** From the footer data, not from the session. */
	branch: string | null;
	/** Ahead, behind and dirty, from asking git. Undefined outside a repository. */
	git: GitState | undefined;
	/** Short host name, so a line pasted into a chat still says which machine it came from. */
	host: string | undefined;
	sessionName: string | undefined;
	/** The provider as it wants to be written, not the id pi uses. */
	model: { id: string; name: string; provider: string; reasoning: boolean } | undefined;
	thinking: string | undefined;
	context: { percent: number; tokens: number; contextWindow: number } | undefined;
	totals: Totals;
	cacheHit: number | undefined;
	/** Tokens per second over the last answer, measured from the first piece to the end. */
	rate: number | undefined;
	firstTokenMs: number | undefined;
	/** The answer running right now, or the last one when nothing is running. */
	turn: TurnData | undefined;
	/** How long the model has spent writing across the branch, for the session speed. */
	generationMs: number;
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
	/** The quieter data, like the machine and the version. */
	muted(text: string): string;
	/** What I am looking at: the folder, the provider. */
	accent(text: string): string;
	/** A good number, like the speed or a clean tree. */
	success(text: string): string;
	/** Attention, like time spent or a dirty tree. */
	warning(text: string): string;
	/** Money adding up faster than I would like. */
	error(text: string): string;
	/** The model, which is what the whole line hangs on. */
	bold(text: string): string;
	/** The context gauge turns warm as it fills. */
	context(percent: number, text: string): string;
}

/** Used by tests and by anything rendering without a theme. */
export const PLAIN: Paint = {
	dim: identity,
	muted: identity,
	accent: identity,
	success: identity,
	warning: identity,
	error: identity,
	bold: identity,
	context: (_percent, text) => text,
};

export type Part = string | undefined;

const GAUGE_CELLS = 8;

const ICON = {
	host: "⌂",
	version: "◈",
	git: "⎇",
	context: "≡",
	provider: "⬢",
	thinking: "✦",
	rate: "⚡",
	ttft: "⏱",
	cache: "≋",
	turnTokens: "⬆",
	turnOut: "⤓",
	sessionTps: "⟳",
	turn: "✓",
	running: "◷",
	statuses: "≫",
};

/** A bar that fills with the effort, so the level reads at a glance. */
const EFFORT_ICON: Record<string, string> = {
	off: "▁",
	minimal: "▂",
	low: "▃",
	medium: "▅",
	high: "▇",
};

type Renderer = (data: SessionData, options: SegmentOptions, paint: Paint) => Part | Part[];

const SEGMENTS: Record<SegmentId, Renderer> = {
	path: (data, options, paint) =>
		paint.accent(shortenPath(data.cwd, data.home, options.pathLength)),
	git: (data, options, paint) => gitLabel(data, options, paint),
	host: (data, options, paint) =>
		data.host === undefined ? undefined : glyph(options, "host", data.host, paint, paint.muted),
	version: (_data, options, paint) => glyph(options, "version", `v${VERSION}`, paint, paint.muted),
	session: (data, _options, paint) =>
		data.sessionName === undefined ? undefined : paint.bold(data.sessionName),
	turn: (data, options, paint) => turnLabel(data, options, paint),
	provider: (data, options, paint) =>
		data.model === undefined
			? undefined
			: glyph(options, "provider", data.model.provider, paint, paint.accent),
	model: (data, _options, paint) => {
		const name = data.model?.name;
		return name === undefined ? undefined : paint.bold(name);
	},
	thinking: (data, options, paint) => {
		const level = data.thinking;
		if (level === undefined) return undefined;
		// More effort is a fuller bar and a warmer color, so the line says how hard the model works.
		const heat: Record<string, (text: string) => string> = {
			high: paint.warning,
			medium: paint.success,
			low: paint.muted,
			off: paint.dim,
		};
		const icon = EFFORT_ICON[level] ?? ICON.thinking;
		return painted(icon, level, options, paint, heat[level] ?? paint.muted);
	},
	rate: (data, options, paint) =>
		data.rate === undefined
			? undefined
			: glyph(options, "rate", `${Math.round(data.rate)} tok/s`, paint, paint.success),
	ttft: (data, options, paint) =>
		data.firstTokenMs === undefined
			? undefined
			: glyph(options, "ttft", seconds(data.firstTokenMs), paint, paint.muted),
	tokens: (data, _options, paint) => {
		const parts: Part[] = [];
		if (data.totals.input > 0) parts.push(`${paint.dim("↑")}${count(data.totals.input)}`);
		if (data.totals.output > 0) parts.push(`${paint.dim("↓")}${count(data.totals.output)}`);
		if (data.totals.cacheRead > 0) parts.push(`${paint.dim("R")}${count(data.totals.cacheRead)}`);
		if (data.totals.cacheWrite > 0) parts.push(`${paint.dim("W")}${count(data.totals.cacheWrite)}`);
		return parts.length === 0 ? undefined : parts;
	},
	turnTokens: (data, options, paint) => {
		const usage = data.turn?.usage;
		if (usage === undefined) return undefined;
		const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		if (total === 0) return undefined;
		const cached = usage.cacheWrite > 0 ? ` + W ${count(usage.cacheWrite)}` : "";
		const breakdown = paint.dim(`(U ${count(usage.input)} + R ${count(usage.cacheRead)}${cached})`);
		return glyph(options, "turnTokens", `${count(total)} ${breakdown}`, paint);
	},
	turnOut: (data, options, paint) => {
		const output = data.turn?.usage.output ?? 0;
		return output === 0 ? undefined : glyph(options, "turnOut", count(output), paint);
	},
	costRate: (data, _options, paint) => {
		const usage = data.turn?.usage;
		return usage === undefined ? undefined : costPerMillion(paint, usage);
	},
	sessionTps: (data, options, paint) => {
		if (data.generationMs <= 0 || data.totals.output === 0) return undefined;
		const rate = data.totals.output / (data.generationMs / 1000);
		return glyph(options, "sessionTps", `avg ${Math.round(rate)} tok/s`, paint, paint.muted);
	},
	cache: (data, options, paint) => {
		if (data.cacheHit === undefined) return undefined;
		const percent = data.cacheHit;
		const color = percent >= 90 ? paint.success : percent >= 50 ? paint.muted : paint.warning;
		return `${paint.dim(label(options, "cache", "cache"))} ${color(`${percent.toFixed(1)}%`)}`;
	},
	cost: (data, _options, paint) => {
		// A subscription session that has not spent anything says nothing.
		if (data.totals.cost === 0) return undefined;
		const amount = data.totals.cost;
		const color = amount >= 10 ? paint.error : amount >= 1 ? paint.warning : paint.muted;
		return `${color(`$${amount.toFixed(3)}`)}${data.subscription ? paint.dim(" (sub)") : ""}`;
	},
	context: (data, options, paint) => {
		if (!data.context) return undefined;
		const { percent, tokens, contextWindow } = data.context;
		const mark = options.icons ? `${paint.dim(ICON.context)} ` : "";
		const gauge = options.gauge ? ` ${gaugeBar(percent)}` : "";
		const window = ` ${count(tokens)}/${count(contextWindow)}`;
		return paint.context(percent, `${mark}${percent.toFixed(1)}%${gauge}${paint.dim(window)}`);
	},
	statuses: (data, options, paint) => {
		if (!options.statuses || data.statuses.length === 0) return undefined;
		const mark = options.icons ? `${paint.dim(ICON.statuses)} ` : "";
		const body = data.statuses.map((text) => paint.muted(text)).join(` ${paint.dim("·")} `);
		return `${mark}${body}`;
	},
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
		git: undefined,
		host: undefined,
		sessionName: undefined,
		model: undefined,
		thinking: undefined,
		context: undefined,
		totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		cacheHit: undefined,
		rate: undefined,
		firstTokenMs: undefined,
		turn: undefined,
		generationMs: 0,
		statuses: [],
		subscription: false,
	};
}

function identity(text: string): string {
	return text;
}

/** The branch, how far it is from its upstream, and whether anything is uncommitted. */
function gitLabel(data: SessionData, options: SegmentOptions, paint: Paint): Part {
	if (data.branch === null) return undefined;

	const marks: string[] = [];
	if (data.git !== undefined) {
		if (data.git.ahead > 0) marks.push(paint.success(`↑${data.git.ahead}`));
		if (data.git.behind > 0) marks.push(paint.warning(`↓${data.git.behind}`));
		if (data.git.dirty) marks.push(paint.warning("*"));
	}

	const branch = paint.bold(data.branch);
	if (data.branch === "detached") return branch;
	return `${options.icons ? `${paint.dim(ICON.git)} ` : ""}${branch}${marks.join("")}`;
}

function turnLabel(data: SessionData, options: SegmentOptions, paint: Paint): Part {
	const turn = data.turn;
	if (turn === undefined) return undefined;
	const icon = turn.running ? ICON.running : ICON.turn;
	const color = turn.running ? paint.warning : paint.success;
	const body = color(duration(turn.elapsedMs));
	return options.icons ? `${paint.dim(icon)} ${body}` : body;
}

function costPerMillion(paint: Paint, usage: Totals): Part {
	const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	if (usage.cost === 0 || tokens === 0) return undefined;
	const perMillion = (usage.cost / tokens) * 1_000_000;
	// Under half a cent per million there is nothing to say.
	return perMillion < 0.005 ? undefined : paint.muted(`$${perMillion.toFixed(2)}/M`);
}

/** A value with its glyph in front, both painted. */
function glyph(
	options: SegmentOptions,
	name: keyof typeof ICON,
	text: string,
	paint: Paint,
	color: (text: string) => string = identity,
): string {
	return painted(ICON[name], text, options, paint, color);
}

/** The same, for a segment that picks its own glyph, like the effort bar. */
function painted(
	icon: string,
	text: string,
	options: SegmentOptions,
	paint: Paint,
	color: (text: string) => string,
): string {
	return options.icons ? `${paint.dim(icon)} ${color(text)}` : color(text);
}

/** A word the segment carries itself, like `cache`, with the glyph before it. */
function label(options: SegmentOptions, name: keyof typeof ICON, text: string): string {
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
	const secs = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${secs}s`;
	return `${secs}s`;
}

function seconds(milliseconds: number): string {
	return milliseconds < 1000
		? `${Math.round(milliseconds)}ms`
		: `${(milliseconds / 1000).toFixed(1)}s`;
}
