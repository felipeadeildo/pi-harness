// One glyph per kind of data, in three sets. Nerd Font glyphs live in the private use area, so they
// are written as escapes: a font without them shows a box, and a reviewer sees which code point it is.
export type IconMode = "auto" | "nerd" | "unicode" | "ascii";
export type IconSet = Exclude<IconMode, "auto">;

export interface Glyphs {
	set: IconSet;
	folder: string;
	branch: string;
	host: string;
	session: string;
	version: string;
	model: string;
	effort: string;
	context: string;
	speed: string;
	wait: string;
	running: string;
	done: string;
	sent: string;
	received: string;
	cacheRead: string;
	cacheWrite: string;
	cost: string;
	clock: string;
	plug: string;
	ahead: string;
	behind: string;
	staged: string;
	modified: string;
	untracked: string;
	conflicted: string;
	stashed: string;
	/** Full and empty cells of a gauge. Blocks, so the gauge never reads as part of a border rule. */
	fill: string;
	empty: string;
	/** Six rising bars, one per effort level from minimal to max. */
	levels: readonly string[];
	ellipsis: string;
}

const COMMON = {
	ahead: "↑",
	behind: "↓",
	staged: "+",
	modified: "~",
	untracked: "?",
	conflicted: "!",
	sent: "↑",
	received: "↓",
};

export const NERD: Glyphs = {
	...COMMON,
	set: "nerd",
	folder: "\u{f07c}", // nf-fa-folder_open
	branch: "\u{e0a0}", // nf-pl-branch
	host: "\u{f108}", // nf-fa-desktop
	session: "\u{f02b}", // nf-fa-tag
	version: "π",
	model: "\u{f06a9}", // nf-md-robot
	effort: "\u{f09d1}", // nf-md-brain
	context: "\u{f035b}", // nf-md-memory
	speed: "\u{f04c5}", // nf-md-speedometer
	wait: "\u{f252}", // nf-fa-hourglass_half
	running: "\u{f017}", // nf-fa-clock_o
	done: "\u{f00c}", // nf-fa-check
	cacheRead: "\u{f1c0}", // nf-fa-database
	cacheWrite: "\u{f0c7}", // nf-fa-floppy_o
	cost: "$",
	clock: "\u{f017}", // nf-fa-clock_o
	plug: "\u{f1e6}", // nf-fa-plug
	stashed: "\u{f01c}", // nf-fa-inbox
	fill: "█",
	empty: "░",
	levels: ["▂", "▃", "▄", "▅", "▆", "▇"],
	ellipsis: "…",
};

/** Symbols every monospace font with decent Unicode coverage has, all one column wide. */
export const UNICODE: Glyphs = {
	...COMMON,
	set: "unicode",
	folder: "▸",
	branch: "⎇",
	host: "⌂",
	session: "#",
	version: "π",
	model: "◆",
	effort: "✦",
	context: "◔",
	speed: "»",
	wait: "⧗",
	running: "◷",
	done: "✓",
	cacheRead: "≋",
	cacheWrite: "≈",
	cost: "$",
	clock: "◷",
	plug: "≫",
	stashed: "≡",
	fill: "█",
	empty: "░",
	levels: ["▂", "▃", "▄", "▅", "▆", "▇"],
	ellipsis: "…",
};

export const ASCII: Glyphs = {
	set: "ascii",
	folder: "",
	branch: "",
	host: "@",
	session: "#",
	version: "v",
	model: "",
	effort: "",
	context: "ctx",
	speed: "",
	wait: "ttft",
	running: "",
	done: "",
	sent: "^",
	received: "v",
	cacheRead: "R",
	cacheWrite: "W",
	cost: "$",
	clock: "",
	plug: ">>",
	ahead: "^",
	behind: "v",
	staged: "+",
	modified: "~",
	untracked: "?",
	conflicted: "!",
	stashed: "s",
	fill: "#",
	empty: "-",
	levels: ["|", "|", "|", "|", "|", "|"],
	ellipsis: "...",
};

const SETS: Record<IconSet, Glyphs> = { nerd: NERD, unicode: UNICODE, ascii: ASCII };

/**
 * Auto trusts a local UTF-8 terminal to have a Nerd Font. Over SSH the font lives on the other
 * machine, so it drops to plain Unicode, and a terminal that does not speak UTF-8 gets ASCII.
 */
export function resolveIcons(mode: IconMode, env: NodeJS.ProcessEnv = process.env): Glyphs {
	if (mode !== "auto") return SETS[mode];
	if (env.TERM === "dumb") return ASCII;
	const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG;
	if (locale !== undefined && locale !== "" && !/utf-?8/i.test(locale)) return ASCII;
	if (env.SSH_TTY !== undefined || env.SSH_CONNECTION !== undefined) return UNICODE;
	return NERD;
}
