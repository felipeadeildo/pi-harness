// Colour, without a single colour value. Every role names a token of the active pi theme, so the look
// follows whatever theme is on: the built-in ones, a custom JSON, or the desktop palette this package
// writes from matugen. Change the theme and every piece moves with it.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/** What a piece of text is. The table below says which theme token paints it. */
export type Role =
	| "path"
	| "branch"
	| "ahead"
	| "behind"
	| "staged"
	| "modified"
	| "untracked"
	| "conflicted"
	| "host"
	| "session"
	| "version"
	| "provider"
	| "model"
	| "sent"
	| "received"
	| "cache"
	| "speed"
	| "wait"
	| "running"
	| "done"
	| "cost"
	| "clock"
	| "brand";

/**
 * The palette, as theme tokens. Syntax tokens are borrowed on purpose: a theme spends its hues there,
 * so they give the line variety that stays in the theme's family.
 */
export const ROLE_TOKENS: Record<Role, ThemeColor> = {
	path: "accent",
	branch: "syntaxFunction",
	ahead: "success",
	behind: "warning",
	staged: "success",
	modified: "warning",
	untracked: "muted",
	conflicted: "error",
	host: "syntaxType",
	session: "mdHeading",
	version: "muted",
	provider: "syntaxKeyword",
	model: "text",
	sent: "mdLink",
	received: "success",
	cache: "syntaxType",
	speed: "success",
	wait: "syntaxNumber",
	running: "accent",
	done: "success",
	cost: "syntaxNumber",
	clock: "muted",
	brand: "accent",
};

/** Pi gives every effort level its own token, which a theme draws as a ramp from cool to hot. */
const EFFORT_TOKENS: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface Paint {
	/** Separators, units and labels sit back, so the data reads first. */
	dim(text: string): string;
	/** Quieter data. */
	muted(text: string): string;
	text(text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	role(role: Role, text: string): string;
	/** The colour of one effort level. */
	effort(level: string, text: string): string;
	/** Calm under half, warm past 70%, alarming past 90%. */
	stress(percent: number, text: string): string;
	/** Money reads calm until it adds up. */
	money(amount: number, text: string): string;
	/** The editor frame, which pi recolours with the effort level and for bash mode. */
	frame(text: string): string;
}

export function themePaint(theme: Theme, frame?: (text: string) => string): Paint {
	return {
		dim: (text) => theme.fg("dim", text),
		muted: (text) => theme.fg("muted", text),
		text: (text) => theme.fg("text", text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		role: (role, text) => theme.fg(ROLE_TOKENS[role], text),
		effort: (level, text) => theme.fg(EFFORT_TOKENS[level] ?? "thinkingOff", text),
		stress: (percent, text) => theme.fg(stressToken(percent), text),
		money: (amount, text) => theme.fg(moneyToken(amount), text),
		frame: frame ?? ((text) => theme.fg("border", text)),
	};
}

export function stressToken(percent: number): ThemeColor {
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

function moneyToken(amount: number): ThemeColor {
	if (amount >= 10) return "error";
	if (amount >= 1) return "warning";
	return ROLE_TOKENS.cost;
}

/** Used by tests and by anything drawing without a theme. */
export const PLAIN: Paint = {
	dim: identity,
	muted: identity,
	text: identity,
	bold: identity,
	italic: identity,
	role: (_role, text) => text,
	effort: (_level, text) => text,
	stress: (_percent, text) => text,
	money: (_amount, text) => text,
	frame: identity,
};

function identity(text: string): string {
	return text;
}
