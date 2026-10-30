// Every character the harness draws with, by name. Nerd Font marks live in look's icon sets.

/** Marks in running text. */
export const GLYPH = {
	/** π, pi's own entries and the harness's name. */
	pi: "\u03c0",
	/** ✓ done, picked, passed. */
	check: "\u2713",
	/** ✗ failed. */
	cross: "\u2717",
	/** × close, remove. */
	times: "\u00d7",
	/** ↑ */
	up: "\u2191",
	/** ↓ */
	down: "\u2193",
	/** ← */
	left: "\u2190",
	/** → to whom, from what to what. */
	right: "\u2192",
	/** ⇄ two agents writing to each other, in the rooms' conversations. */
	both: "\u21c4",
	/** ↵ enter. */
	enter: "\u21b5",
	/** ↻ again. */
	again: "\u21bb",
	/** ❯ the selected row. */
	pointer: "\u276f",
	/** › a note on an option, a continuation. */
	chevron: "\u203a",
	/** ▸ a small pointer. */
	triangle: "\u25b8",
	/** ◆ an agent, a task in progress. */
	diamond: "\u25c6",
	/** ◇ an empty diamond: a task not started, a quiet mark. */
	diamondEmpty: "\u25c7",
	/** ◈ the judge. */
	judge: "\u25c8",
	/** ● on. */
	dot: "\u25cf",
	/** ○ off, not answered. */
	ring: "\u25cb",
	/** ◐ half: hearing a room without taking part in it. */
	half: "\u25d0",
	/** ◌ hidden, as tool output pruned from the context. */
	ringDotted: "\u25cc",
	/** ✎ words you typed. */
	pencil: "\u270e",
	/** ⚑ flagged. */
	flag: "\u2691",
	/** ⏵ running. */
	play: "\u23f5",
	/** ⌕ search. */
	search: "\u2315",
	/** ▍ where words arrive. */
	cursor: "\u258d",
	/** ▌ the bar on a selected row. */
	bar: "\u258c",
	/** ⋮ lines hidden above. */
	ellipsisUp: "\u22ee",
	/** ⋯ a gap between parts, as between two edits. */
	ellipsisAcross: "\u22ef",
} as const;

/** Frames of the marks that move while something lasts, in order. */
export const SPIN = {
	/** ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏ a dot going round in one cell: someone writing. */
	braille: [
		"\u280b",
		"\u2819",
		"\u2839",
		"\u2838",
		"\u283c",
		"\u2834",
		"\u2826",
		"\u2827",
		"\u2807",
		"\u280f",
	],
	/** ◴ ◷ ◶ ◵ a quarter of a circle going round: a call running. */
	quadrants: ["\u25f4", "\u25f7", "\u25f6", "\u25f5"],
	/** ⧖ ⧗ an hourglass and the same one flowing: a call waiting on you. */
	hourglass: ["\u29d6", "\u29d7"],
	/** | / - \ the same, in ASCII. */
	ascii: ["|", "/", "-", "\\"],
	/** ✎ ✏ ✐ ✏ a pencil that tilts as it writes, in one cell: the model writing a call. */
	pencil: ["\u270e", "\u270f", "\u2710", "\u270f"],
} as const;

/** Three dots rather than `…`, which is one column in every font. */
export const CUT = "...";

/** The lines frames, rules and scroll bars are drawn with. */
export const LINE = {
	/** ─ */
	h: "\u2500",
	/** │ */
	v: "\u2502",
	/** ┃ the thumb of a scroll bar, and the sides of what is chosen. */
	vHeavy: "\u2503",
	/** ━ */
	hHeavy: "\u2501",
	/** ┏ */
	topLeftHeavy: "\u250f",
	/** ┓ */
	topRightHeavy: "\u2513",
	/** ┗ */
	bottomLeftHeavy: "\u2517",
	/** ┛ */
	bottomRightHeavy: "\u251b",
	/** ┄ a frame around what has not happened yet. */
	hDashed: "\u2504",
	/** ┆ */
	vDashed: "\u2506",
	/** ╭ */
	topLeft: "\u256d",
	/** ╮ */
	topRight: "\u256e",
	/** ╰ */
	bottomLeft: "\u2570",
	/** ╯ */
	bottomRight: "\u256f",
	/** ├ a rule that meets the left side. */
	teeLeft: "\u251c",
	/** ┤ a rule that meets the right side. */
	teeRight: "\u2524",
	/** ┬ a column that meets the top edge. */
	teeTop: "\u252c",
	/** ┴ a column that meets the bottom edge. */
	teeBottom: "\u2534",
} as const;
