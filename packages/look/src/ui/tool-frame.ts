// Every tool call in its own frame: name on the top rule, call and result inside, how it went on the bottom rule.
import {
	CUT,
	type CallRuling,
	isObject,
	type FeatureScope,
	CALLS_FRAMED,
	RULING,
	type RulingTone,
	GLYPH,
	LINE,
} from "@adeildo/pi-kit";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getKeybindings,
	stripTerminalSequences,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { editBody } from "../render/diff.ts";
import { tabs } from "../render/format.ts";
import { type IconSet, glyphsOf } from "../render/glyphs.ts";
import { pathLine, type Stream, STREAMERS } from "../render/streaming.ts";
import { stateMark, toolIcon, toolLabel } from "../render/tools.ts";
import { icons } from "../settings.ts";

type Phase = "writing" | "waiting" | "running" | "done" | "failed";

const PHASE_COLORS = {
	writing: "muted",
	waiting: "accent",
	running: "accent",
	done: "success",
	failed: "error",
} as const;
const BODY_PAD = 4;
const COLLAPSED_ARGS_CHARS = 100;
const RESULT_PREVIEW_LINES = 10;

export function registerToolFrames(scope: FeatureScope): void {
	const redraws = new Map<string, () => void>();
	const written = new Map<string, number>();
	// Asked for on every drawing, and it changes only with the setting.
	const set = glyphsOf(() => icons.get(scope));
	CALLS_FRAMED.provide(scope, () => true);
	RULING.onChanged(scope, (_ruling, toolCallId) => redraws.get(toolCallId)?.());
	// Pi completes a message's calls only when the message ends; the provider says when each one ends.
	scope.on("message_update", (event) => {
		const update = event.assistantMessageEvent;
		if (update.type === "toolcall_end") written.set(update.toolCall.id, Date.now());
	});

	scope.registerToolRenderer((toolName, next) =>
		framed(scope, next(), {
			name: toolName,
			set: () => set().set,
			redraws,
			written,
		}),
	);
}

interface FrameContext {
	name: string;
	set: () => IconSet;
	redraws: Map<string, () => void>;
	written: Map<string, number>;
}

function framed(
	scope: FeatureScope,
	base: ToolRenderers | undefined,
	frame: FrameContext,
): ToolRenderers {
	// The frame wraps whichever half a tool brings a renderer for.
	const call = base?.renderCall ?? genericCall;
	const result = base?.renderResult ?? genericResult;

	// Pi's renderers mutate the component they returned last time, so they get that one back, not the frame.
	const inner = new WeakMap<Component, Component | undefined>();
	const passed = (last: Component | undefined): Component | undefined =>
		last === undefined || !inner.has(last) ? last : inner.get(last);
	const streamer = STREAMERS[frame.name];

	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			frame.redraws.set(context.toolCallId, context.invalidate);
			const clock = clockOf(context);
			const now = Date.now();
			const ended = frame.written.get(context.toolCallId);
			frame.written.delete(context.toolCallId);
			// A call replayed or already running was written long ago.
			const done =
				ended !== undefined ||
				context.argsComplete ||
				context.executionStarted ||
				!context.isPartial;
			if (!done) clock.writingAt ??= now;
			else clock.writtenAt ??= ended ?? now;
			if (context.executionStarted) clock.startedAt ??= now;
			const writing = clock.writtenAt === undefined;
			const ruling = RULING.current(scope, context.toolCallId);

			// Pi hands every call its arguments again on each piece the model writes, so an unchanged call keeps its frame.
			const inputs = [
				args,
				theme,
				ruling,
				writing,
				context.expanded,
				context.isPartial,
				context.executionStarted,
			];
			const last = context.lastComponent;
			if (last instanceof CallFrame && last.drawnFrom(inputs)) return last;

			const stream = streamer?.(args, theme, {
				cwd: context.cwd,
				expanded: context.expanded,
				writing,
				state: context.state as object,
			});
			// While the model writes, pi's renderer has nothing new to show. The frame pads its inside itself.
			const streaming = writing && stream !== undefined;
			const own = streaming
				? undefined
				: call(args, theme, {
						...context,
						argsComplete: !writing,
						outputPad: 0,
						lastComponent: passed(last),
					});
			// Pi paints its edit on a colored box; the frame draws the diff itself, in the diff colors.
			const drawnOwn = (component: Component): Component =>
				frame.name === "edit" && isObject(args)
					? editBody(component, pathLine("edit", pathOf(args), theme), theme)
					: component;
			const body =
				own === undefined ? drawnBody(stream?.lines ?? []) : orStream(drawnOwn(own), stream);

			const box = new CallFrame(
				{
					theme,
					icon: toolIcon(frame.name, frame.set()),
					label: toolLabel(frame.name),
					body,
					ruling,
					expanded: context.expanded,
					phase: phaseOf(context, writing),
					mark: stateMark,
					set: frame.set,
					progress: writing ? stream?.progress : undefined,
					clock,
					executing: context.isPartial && context.executionStarted,
					runningAs: RUNNING_WORDS[frame.name],
				},
				inputs,
			);
			inner.set(box, own);
			return box;
		},
		renderResult(shown, options, theme, context) {
			const clock = clockOf(context);
			// A blocked call prints only the reason the line above already gives.
			const blocked = RULING.current(scope, context.toolCallId)?.blocked === true;
			// Pi draws a result's pictures right below the frame, so the frame counts them.
			const images = shown.content.filter((block) => block.type === "image").length;
			if (!options.isPartial) clock.endedAt ??= Date.now();
			clock.resulted = true;
			const body = result(shown, options, theme, {
				...context,
				outputPad: 0,
				lastComponent: passed(context.lastComponent),
			});
			const phase: Phase = options.isPartial ? "running" : context.isError ? "failed" : "done";
			const box = new ResultFrame({
				theme,
				body,
				quiet: blocked,
				phase,
				set: frame.set,
				elapsed: ranFor(clock, phase === "running"),
				wrote: wroteFor(clock),
				images: images === 0 ? undefined : `${images} image${images === 1 ? "" : "s"}`,
			});
			inner.set(box, body);
			return box;
		},
	};
}

const genericCall: NonNullable<ToolRenderers["renderCall"]> = (args, theme, context) =>
	new Text(callText(args, theme, context.expanded), 0, 0);

const genericResult: NonNullable<ToolRenderers["renderResult"]> = (result, options, theme) =>
	new Text(resultText(result, options.expanded, theme), 0, 0);

const RUNNING_WORDS: Readonly<Record<string, string>> = {
	ask_questions: "waiting for your answer",
};

/** Without a result: writing the arguments, then waiting to run. */
function phaseOf(
	context: { isPartial: boolean; executionStarted: boolean },
	writing: boolean,
): Phase | undefined {
	if (!context.isPartial || context.executionStarted) return undefined;
	return writing ? "writing" : "waiting";
}

function callText(args: unknown, theme: Theme, expanded: boolean): string {
	if (args === null || args === undefined) return "";

	const entries: [string, unknown][] =
		typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
	if (entries.length === 0) return "";

	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text =
				typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${tabs(text).split("\n").join("\n    ")}`;
		});
		return theme.fg("muted", lines.join("\n"));
	}

	const pairs = entries
		.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`)
		.join(" ");
	const preview =
		pairs.length > COLLAPSED_ARGS_CHARS ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : pairs;
	return theme.fg("muted", preview);
}

function resultText(
	result: { content: readonly { type: string; text?: string }[] },
	expanded: boolean,
	theme: Theme,
): string {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => stripTerminalSequences(block.text ?? "").replace(/\r/g, ""))
		.join("\n");
	if (text === "") return "";

	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, RESULT_PREVIEW_LINES);
	const printed = shown.map((line) => theme.fg("toolOutput", line));
	if (shown.length < lines.length)
		printed.push(
			theme.fg("muted", `... (${lines.length - shown.length} more lines, ${expandHint(theme)})`),
		);
	return printed.join("\n");
}

function expandHint(theme: Theme): string {
	const keys = getKeybindings().getKeys("app.tools.expand");
	if (keys.length === 0) return theme.fg("muted", "expand");
	return `${theme.fg("dim", keys.join("/"))}${theme.fg("muted", " to expand")}`;
}

interface FrameParts {
	theme: Theme;
	body: Component;
}

class CallFrame implements Component {
	#drawn?: Drawn;
	/** Set when pi or the terminal asks for a fresh drawing. */
	#stale = false;

	constructor(
		private readonly parts: FrameParts & CallParts,
		private readonly inputs: readonly unknown[],
	) {}

	drawnFrom(inputs: readonly unknown[]): boolean {
		return (
			!this.#stale &&
			inputs.length === this.inputs.length &&
			inputs.every((input, index) => input === this.inputs[index])
		);
	}

	invalidate(): void {
		this.#drawn = undefined;
		this.#stale = true;
		this.parts.body.invalidate();
	}

	render(width: number): string[] {
		const { theme, icon, label, ruling, expanded, clock } = this.parts;
		// A running call closes too until its result draws the rest of the frame.
		const running = this.parts.executing === true && clock?.resulted !== true;
		const phase = this.parts.phase ?? (running ? "running" : undefined);
		// Read on every drawing, so the time goes on while nothing new arrives.
		const time = clock === undefined || phase === undefined ? undefined : timeOf(phase, clock);
		const mark = phase === undefined ? undefined : this.parts.mark(phase, this.parts.set());
		const body = this.parts.body.render(room(width));
		const progress = this.parts.progress?.join("\u0000");
		const drawn = { width, body, rest: [ruling, expanded, phase, time, progress, mark] };
		if (unchanged(this.#drawn, drawn)) return this.#drawn.lines;

		const title = `${theme.fg("toolTitle", icon)} ${theme.fg("toolTitle", theme.bold(label))}`;
		const lines = [rule("top", title, width, theme), ...inside(withoutBlanks(body), width, theme)];
		if (ruling !== undefined)
			lines.push(...inside([rulingText(ruling, theme, expanded)], width, theme));
		// With nothing else to show yet, the frame closes with what the call is doing.
		if (phase !== undefined && mark !== undefined) {
			const times = [time, ...(this.parts.progress ?? [])];
			const word = phase === "running" ? this.parts.runningAs : undefined;
			const closing = phaseLabel(theme, mark, phase, times, word);
			lines.push(rule("bottom", closing, width, theme, PHASE_COLORS[phase]));
		}
		this.#drawn = { ...drawn, lines };
		return lines;
	}
}

interface CallParts {
	icon: string;
	label: string;
	ruling?: CallRuling;
	expanded: boolean;
	phase?: Phase;
	mark: (phase: Phase, set: IconSet) => string;
	set: () => IconSet;
	progress?: readonly string[];
	clock?: Clock;
	/** It runs and its result is not final. */
	executing?: boolean;
	/** When the tool's running means something else. */
	runningAs?: string;
}

function drawnBody(drawn: readonly string[]): Component {
	return { render: () => [...drawn], invalidate: () => {} };
}

/** The stream while pi's body is still only its first line. */
function orStream(own: Component, stream: Stream | undefined): Component {
	if (stream === undefined) return own;
	return {
		render(width) {
			const drawn = own.render(width);
			return withoutBlanks(drawn).length > 1 ? drawn : [...stream.lines];
		},
		invalidate: () => own.invalidate(),
	};
}

class ResultFrame implements Component {
	#drawn?: Drawn;

	constructor(private readonly parts: FrameParts & ResultParts) {}

	invalidate(): void {
		this.#drawn = undefined;
		this.parts.body.invalidate();
	}

	render(width: number): string[] {
		const { theme, phase, wrote, quiet, images } = this.parts;
		const time = this.parts.elapsed;
		const mark = stateMark(phase, this.parts.set());
		const body = this.parts.body.render(room(width));
		const drawn = { width, body, rest: [phase, mark, time, wrote, images, quiet] };
		if (unchanged(this.#drawn, drawn)) return this.#drawn.lines;

		const printed =
			quiet === true ? [] : withoutBlanks(dropTime(body)).map((line) => hidden(line, theme));
		const lines = [
			// A call with nothing to print has no cut.
			...(printed.length === 0 ? [] : [cut(width, theme), ...inside(printed, width, theme)]),
			rule(
				"bottom",
				phaseLabel(theme, mark, phase, [
					time,
					wrote === undefined ? undefined : `wrote ${wrote}`,
					images === undefined ? undefined : `with ${images}`,
				]),
				width,
				theme,
				PHASE_COLORS[phase],
			),
		];
		this.#drawn = { ...drawn, lines };
		return lines;
	}
}

interface ResultParts {
	phase: Phase;
	set: () => IconSet;
	elapsed?: string;
	wrote?: string;
	/** Pi draws them outside the frame. */
	images?: string;
	/** Nothing worth printing, like a call the gate blocked. */
	quiet?: boolean;
}

function rule(
	edge: "top" | "bottom",
	left: string,
	width: number,
	theme: Theme,
	color: "accent" | "success" | "error" | "muted" | "border" = "border",
): string {
	const [start, end] =
		edge === "top" ? [LINE.topLeft, LINE.topRight] : [LINE.bottomLeft, LINE.bottomRight];
	const paint = (text: string) => theme.fg(color, text);
	const cell = left === "" ? "" : ` ${left} `;
	const fill = Math.max(1, width - BODY_PAD - visibleWidth(cell));
	const line =
		paint(`${start}${LINE.h}`) + cell + paint(LINE.h.repeat(fill)) + paint(`${LINE.h}${end}`);
	return fill === 1 ? truncateToWidth(line, width, "") : line;
}

function cut(width: number, theme: Theme): string {
	const paint = (text: string) => theme.fg("border", text);
	const fill = Math.max(1, width - BODY_PAD);
	const line = `${paint(LINE.teeLeft)}${paint(LINE.h.repeat(fill + 2))}${paint(LINE.teeRight)}`;
	return fill === 1 ? truncateToWidth(line, width, "") : line;
}

function phaseLabel(
	theme: Theme,
	mark: string,
	phase: Phase,
	times: readonly (string | undefined)[],
	word: string = phase,
): string {
	const cells = times
		.filter((time) => time !== undefined)
		.map((time) => theme.fg("dim", time ?? ""));
	return [`${theme.fg(PHASE_COLORS[phase], mark)} ${theme.fg("muted", word)}`, ...cells].join("  ");
}

function inside(lines: readonly string[], width: number, theme: Theme): string[] {
	const paint = (text: string) => theme.fg("border", text);
	const inner = room(width);
	return trim(lines).map((line) => {
		const wide = visibleWidth(line);
		const text = wide > inner ? truncateToWidth(line, inner, CUT, true) : line;
		const pad = " ".repeat(Math.max(0, inner - (wide > inner ? visibleWidth(text) : wide)));
		return `${paint(LINE.v)} ${text}${pad} ${paint(LINE.v)}`;
	});
}

interface Drawn {
	width: number;
	body: readonly string[];
	rest: readonly unknown[];
	lines: string[];
}

/** Keeps typing cheap. */
function unchanged(drawn: Drawn | undefined, next: Omit<Drawn, "lines">): drawn is Drawn {
	if (drawn === undefined || drawn.width !== next.width) return false;
	if (drawn.body.length !== next.body.length || drawn.rest.length !== next.rest.length)
		return false;
	if (drawn.rest.some((part, index) => part !== next.rest[index])) return false;
	// A renderer that kept its lines hands back the same array.
	return drawn.body === next.body || drawn.body.every((line, index) => line === next.body[index]);
}

function room(width: number): number {
	return Math.max(1, width - BODY_PAD);
}

/** As `... (240 earlier lines, ctrl+o to expand)`. */
const HIDDEN = /^\.\.\. \((\d+) (earlier|more) lines, (.+?) to expand\)$/u;

export function hidden(line: string, theme: Theme): string {
	if (!line.includes(" to expand)")) return line;
	const match = HIDDEN.exec(stripTerminalSequences(line).trim());
	if (match === null) return line;
	const [, count, side, key] = match;
	const where = side === "earlier" ? "above" : "below";
	const lines = theme.fg("muted", `${count} lines ${where}`);
	return `${theme.fg("dim", GLYPH.ellipsisUp)} ${lines}  ${theme.fg("dim", key ?? "")}`;
}

/** The frame says the time on the bottom rule instead. */
function dropTime(lines: readonly string[]): string[] {
	const at = lines.findLastIndex((line) => !isBlank(line));
	if (at === -1) return [...lines];
	if (!/^(Took|Elapsed) [\d.]/u.test(stripTerminalSequences(lines[at] ?? "").trim()))
		return [...lines];
	return lines.slice(0, at);
}

interface Clock {
	writingAt?: number;
	writtenAt?: number;
	startedAt?: number;
	endedAt?: number;
	/** Closes the frame from then on. */
	resulted?: boolean;
}

function clockOf(context: { state: unknown }): Clock {
	return context.state as Clock;
}

function wroteFor(clock: Clock): string | undefined {
	if (clock.writingAt === undefined || clock.writtenAt === undefined) return undefined;
	return elapsed(clock.writtenAt - clock.writingAt);
}

function ranFor(clock: Clock, running: boolean): string | undefined {
	if (clock.startedAt === undefined) return undefined;
	const end = clock.endedAt ?? (running ? Date.now() : undefined);
	return end === undefined ? undefined : elapsed(end - clock.startedAt);
}

function timeOf(phase: Phase, clock: Clock): string | undefined {
	if (phase === "running") return ranFor(clock, true);
	const from = phase === "waiting" ? clock.writtenAt : clock.writingAt;
	return from === undefined ? undefined : elapsed(Date.now() - from);
}

function elapsed(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const total = Math.floor(seconds);
	if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
	return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

function trim(lines: readonly string[]): string[] {
	let [from, to] = [0, lines.length];
	while (from < to && isBlank(lines[from])) from++;
	while (to > from && isBlank(lines[to - 1])) to--;
	return lines.slice(from, to);
}

function withoutBlanks(lines: readonly string[]): string[] {
	return lines.filter((line) => !isBlank(line));
}

export function isBlank(line: string | undefined): boolean {
	if (line === undefined) return true;
	// A line of only color codes reads as blank; one without escapes needs no stripping.
	return (line.includes("\u001b") ? stripTerminalSequences(line) : line).trim() === "";
}

function rulingText(ruling: CallRuling, theme: Theme, expanded: boolean): string {
	const color = PHASE_COLORS[stateOf(ruling.tone)];
	let line = `${theme.fg(color, GLYPH.judge)} ${theme.fg(color, ruling.head)}`;
	if (ruling.note) line += ` ${theme.fg("accent", GLYPH.chevron)} ${ruling.note}`;
	if (ruling.why) line += `  ${theme.fg("muted", ruling.why)}`;
	if (expanded && ruling.detail) line += ` ${theme.fg("dim", `(${ruling.detail})`)}`;
	return line;
}

function stateOf(tone: RulingTone): Phase {
	switch (tone) {
		case "pending":
			return "running";
		case "success":
			return "done";
		default:
			return "failed";
	}
}

function pathOf(args: Record<string, unknown>): string | undefined {
	return typeof args.path === "string" ? args.path : undefined;
}
