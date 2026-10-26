// Pi's own transcript entries in the harness frame instead of a background. Pi has no hook for
// drawing them, so this wraps each component's render.
import { CHANGES_CUT, CHANGES_X, entryFrame, type EntryFrame, GLYPH } from "@adeildo/pi-kit";
import {
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	SkillInvocationMessageComponent,
	type Theme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import type { IconSet } from "../render/glyphs.ts";
import { isBlank } from "./tool-frame.ts";

/** Undefined leaves pi's entries as they are. `from` names the client a prompt came from. */
export type EntryPaint = () =>
	| { theme: Theme; set: IconSet; you: boolean; from?: (text: string) => string | undefined }
	| undefined;

const YOU: Readonly<Record<IconSet, string>> = {
	nerd: "\u{f007}", // nf-fa-user
	unicode: GLYPH.triangle,
	ascii: ">",
};
/** The shell integration markers pi puts on your message's first and last line. */
// oxlint-disable-next-line no-control-regex -- the markers are escape sequences
const MARKERS = /^(?:\u001b\]133;[^\u0007]*\u0007)*/;
// oxlint-disable-next-line no-control-regex -- colour codes are escape sequences
const BACKGROUND = /\u001b\[(?:48;[25];[\d;]+|49|4[0-7]|10[0-7])m/g;
/** Pi's bracketed label, as `[compaction]`, which the frame's top edge replaces. */
// oxlint-disable-next-line no-control-regex -- the label is wrapped in bold codes
const LABEL = /(\u001b\[1m)?\[[\w:.-]+\](\u001b\[22m)? ?/;

type Paint = NonNullable<ReturnType<EntryPaint>>;

interface Framing extends EntryFrame {
	/** As `[compaction]`. */
	label?: boolean;
	rules?: boolean;
}
type Render = (width: number) => string[];

let installed = false;
let paint: EntryPaint = () => undefined;

/** Calling it again only changes where the paint comes from. */
export function framePiEntries(source: EntryPaint): void {
	paint = source;
	if (installed) return;
	installed = true;
	wrap(UserMessageComponent, (self, look) =>
		look.you ? youFrame(look, fromOf(self, look)) : undefined,
	);
	wrap(CompactionSummaryMessageComponent, (_self, look) => pi(look, "compacted"));
	wrap(BranchSummaryMessageComponent, (_self, look) => pi(look, "branch summary"));
	wrap(SkillInvocationMessageComponent, (_self, look) => ({
		top: look.theme.fg("muted", "skill"),
		color: "borderMuted",
		label: true,
	}));
	wrap(CustomMessageComponent, (self, look) => {
		const own = self as unknown as { customComponent?: unknown; message: { customType: string } };
		if (own.customComponent !== undefined) return undefined;
		const top = look.theme.fg("muted", own.message.customType);
		return { top, color: "borderMuted", label: true };
	});
	wrap(BashExecutionComponent, (self, look) => shellFrame(self, look));
}

/** Asked once per message: the client is known before pi draws the prompt, and never changes. */
const sentFrom = new WeakMap<object, string | undefined>();

function fromOf(self: object, look: Paint): string | undefined {
	if (!sentFrom.has(self)) sentFrom.set(self, look.from?.((self as { text?: string }).text ?? ""));
	return sentFrom.get(self);
}

function youFrame(look: Paint, from: string | undefined): Framing {
	const you = `${look.theme.fg("accent", YOU[look.set])} ${look.theme.fg("muted", "you")}`;
	const top = from === undefined ? you : `${you} ${look.theme.fg("dim", `from ${from}`)}`;
	return { top, color: "accent" };
}

function pi(look: Paint, what: string): Framing {
	return { top: look.theme.fg("muted", `${GLYPH.pi} ${what}`), color: "borderMuted", label: true };
}

interface Shell {
	status?: "running" | "complete" | "cancelled" | "error";
	exitCode?: number;
	colorKey?: "bashMode" | "dim";
}

function shellFrame(self: object, look: Paint): Framing {
	const { status, exitCode, colorKey = "bashMode" } = self as Shell;
	const { theme } = look;
	const top = `${theme.fg(colorKey, "!")} ${theme.fg("muted", "shell")}`;
	return { top, bottom: shellPhase(theme, status, exitCode), color: colorKey, rules: true };
}

function shellPhase(theme: Theme, status: Shell["status"], exitCode: number | undefined): string {
	switch (status) {
		case "running":
			return theme.fg("muted", "running");
		case "cancelled":
			return theme.fg("warning", "cancelled");
		case "error":
			return theme.fg("error", `${GLYPH.cross} exit ${exitCode ?? "?"}`);
		default:
			return theme.fg("success", `${GLYPH.check} done`);
	}
}

function wrap(
	component: { prototype: object },
	frameOf: (self: object, look: Paint) => Framing | undefined,
): void {
	const prototype = component.prototype as { render: Render };
	const own = prototype.render;
	prototype.render = function render(this: object, width: number) {
		const look = paint();
		const frame = look === undefined || width < CHANGES_X * 2 ? undefined : frameOf(this, look);
		if (look === undefined || frame === undefined) return own.call(this, width);
		const source = own.call(this, width - 2);
		// Pi caches its own lines, so the frame redraws only when they, the width or the paint change.
		const known = drawnBefore.get(this);
		const key = `${width}\u0000${frame.top}\u0000${frame.bottom}\u0000${frame.color}`;
		if (known?.key === key && known.theme === look.theme && sameLines(known.source, source))
			return known.lines;
		const lines = framed(source, width, look.theme, frame);
		drawnBefore.set(this, { key, theme: look.theme, source, lines });
		return lines;
	};
}

interface Drawn {
	key: string;
	theme: Theme;
	source: readonly string[];
	lines: string[];
}

const drawnBefore = new WeakMap<object, Drawn>();

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
	return true;
}

/** Two columns narrower, with a column of padding each side. */
export function framed(
	body: readonly string[],
	width: number,
	theme: Theme,
	framing: Framing,
): string[] {
	const { label, rules, ...frame } = framing;
	const first = body[0]?.match(MARKERS)?.[0] ?? "";
	const last = body.at(-1)?.match(MARKERS)?.[0] ?? "";
	let lines = body.map((line) => line.replace(MARKERS, "").replace(BACKGROUND, ""));
	if (rules) {
		lines = lines.filter((line) => !/^\u2500+$/.test(stripTerminalSequences(line).trim()));
		const gap = lines.findIndex((line, index) => index > 0 && isBlank(line));
		if (gap > 0 && gap < lines.length - 1) lines[gap] = CHANGES_CUT;
	}
	const trim = () => {
		while (lines.length > 1 && isBlank(lines[0] ?? "")) lines.shift();
		while (lines.length > 1 && isBlank(lines.at(-1) ?? "")) lines.pop();
	};
	trim();
	if (label && lines[0] !== undefined) {
		// Alone on its line it goes with the line; otherwise only the label goes, as `[skill] name`.
		const alone = /^\[[\w:.-]+\]$/.test(stripTerminalSequences(lines[0]).trim());
		if (alone) lines.shift();
		else lines[0] = lines[0].replace(LABEL, "$2");
		trim();
	}
	const drawn = entryFrame(lines, width, theme, { ...frame, pad: 0 });
	drawn[0] = first + drawn[0];
	drawn[drawn.length - 1] = last + drawn.at(-1);
	return drawn;
}
