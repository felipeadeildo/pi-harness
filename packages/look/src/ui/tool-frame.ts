// Draws every tool call in a frame of its own: the mark and the name on the top rule, the call and
// its result inside, and how it went on the bottom rule.
import {
	type CallRuling,
	type FeatureScope,
	FRAMED,
	isObject,
	RULING_CHANGED,
	type RulingTone,
	rulingOf,
} from "@adeildo/pi-kit";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { type IconSet, resolveIcons } from "../render/glyphs.ts";
import { stateMark, toolIcon, toolLabel } from "../render/tools.ts";
import { icons } from "../settings.ts";

type FrameState = "running" | "done" | "failed";

const STATE_COLORS = { running: "accent", done: "success", failed: "error" } as const;
const BODY_PAD = 4;

export function registerToolFrames(scope: FeatureScope): void {
	const redraws = new Map<string, () => void>();
	scope.events.on(FRAMED, (data) => {
		if (isObject(data)) data.framed = true;
	});
	scope.events.on(RULING_CHANGED, (data) => {
		if (isObject(data) && typeof data.toolCallId === "string") redraws.get(data.toolCallId)?.();
	});

	scope.registerToolRenderer((toolName, next) =>
		framed(scope, next(), {
			name: toolName,
			set: () => resolveIcons(icons.get(scope)).set,
			redraws,
		}),
	);
}

interface FrameContext {
	name: string;
	set: () => IconSet;
	redraws: Map<string, () => void>;
}

function framed(
	scope: FeatureScope,
	base: ToolRenderers | undefined,
	frame: FrameContext,
): ToolRenderers | undefined {
	// Pi drops the whole chain when a resolver answers nothing, so a tool it cannot frame keeps
	// whatever the next resolver drew.
	const call = base?.renderCall;
	const result = base?.renderResult;
	if (base === undefined || call === undefined || result === undefined) return base;

	// A renderer of pi's own mutates the component it returned last time, which sits inside the
	// frame, so it gets that one back instead of the frame.
	const inner = new WeakMap<Component, Component>();
	const passed = (last: Component | undefined): Component | undefined =>
		last === undefined ? undefined : (inner.get(last) ?? last);

	return {
		...base,
		// The frame is the shell, so pi does not wrap it in a box of its own.
		renderShell: "self",
		renderCall(args, theme, context) {
			frame.redraws.set(context.toolCallId, context.invalidate);
			const clock = clockOf(context);
			if (context.executionStarted) clock.startedAt ??= Date.now();
			const body = call(args, theme, { ...context, lastComponent: passed(context.lastComponent) });
			const box = new CallFrame({
				theme,
				icon: toolIcon(frame.name, frame.set()),
				label: toolLabel(frame.name),
				body,
				ruling: rulingOf(scope.events, context.toolCallId),
				expanded: context.expanded,
			});
			inner.set(box, body);
			return box;
		},
		renderResult(shown, options, theme, context) {
			const clock = clockOf(context);
			if (!options.isPartial) clock.endedAt ??= Date.now();
			const body = result(shown, options, theme, {
				...context,
				lastComponent: passed(context.lastComponent),
			});
			const state = options.isPartial ? "running" : context.isError ? "failed" : "done";
			const box = new ResultFrame({
				theme,
				body,
				state,
				mark: stateMark(state, frame.set()),
				color: STATE_COLORS[state],
				elapsed: elapsedOf(clock),
			});
			inner.set(box, body);
			return box;
		},
	};
}

interface FrameParts {
	theme: Theme;
	body: Component;
}

/** The top rule and what is inside it, from the call until the result arrives. */
class CallFrame implements Component {
	#drawn?: Drawn;

	constructor(private readonly parts: FrameParts & CallParts) {}

	invalidate(): void {
		this.#drawn = undefined;
		this.parts.body.invalidate();
	}

	render(width: number): string[] {
		const { theme, icon, label, ruling, expanded } = this.parts;
		const body = this.parts.body.render(room(width));
		const drawn = { width, body, rest: [ruling, expanded] };
		if (unchanged(this.#drawn, drawn)) return this.#drawn.lines;

		const title = `${theme.fg("toolTitle", icon)} ${theme.fg("toolTitle", theme.bold(label))}`;
		const lines = [rule("top", title, width, theme), ...inside(body, width, theme)];
		// The decision is about the call, so it stays with the call.
		if (ruling !== undefined)
			lines.push(...inside([rulingText(ruling, theme, expanded)], width, theme));
		lines.push(cut(width, theme));
		this.#drawn = { ...drawn, lines };
		return lines;
	}
}

interface CallParts {
	icon: string;
	label: string;
	ruling?: CallRuling;
	expanded: boolean;
}

/** The result and the bottom rule, which says how the call went. */
class ResultFrame implements Component {
	constructor(
		private readonly parts: FrameParts & {
			mark: string;
			color: "accent" | "success" | "error";
			state: FrameState;
			elapsed?: string;
		},
	) {}

	#drawn?: Drawn;

	invalidate(): void {
		this.#drawn = undefined;
		this.parts.body.invalidate();
	}

	render(width: number): string[] {
		const { theme, mark, color, state } = this.parts;
		const time = this.parts.elapsed;
		const body = this.parts.body.render(room(width));
		const drawn = { width, body, rest: [mark, state, time] };
		if (unchanged(this.#drawn, drawn)) return this.#drawn.lines;

		// The time belongs to the frame, not to the output, so pi's own line goes when the call ends.
		const lines = [
			...inside(state === "running" ? body : dropTime(body), width, theme),
			rule("bottom", bottomLabel(theme, mark, color, state, time), width, theme, color),
		];
		this.#drawn = { ...drawn, lines };
		return lines;
	}
}

/** One rule of the frame: two corners, and what sits on the left. */
function rule(
	edge: "top" | "bottom",
	left: string,
	width: number,
	theme: Theme,
	color: "accent" | "success" | "error" | "border" = "border",
): string {
	const [start, end] = edge === "top" ? ["\u256d", "\u256e"] : ["\u2570", "\u256f"];
	const paint = (text: string) => theme.fg(color, text);
	const cell = left === "" ? "" : ` ${left} `;
	const fill = Math.max(1, width - BODY_PAD - visibleWidth(cell));
	const line =
		paint(`${start}\u2500`) + cell + paint("\u2500".repeat(fill)) + paint(`\u2500${end}`);
	return truncateToWidth(line, width, "");
}

/** The line that ends the call and starts what it printed. */
function cut(width: number, theme: Theme): string {
	const paint = (text: string) => theme.fg("border", text);
	const fill = Math.max(1, width - BODY_PAD);
	const line = `${paint("├")}${paint("─".repeat(fill + 2))}${paint("┤")}`;
	return truncateToWidth(line, width, "");
}

/** Pi prints the time of a call itself, and the frame says it on the bottom rule instead. */
function dropTime(lines: readonly string[]): string[] {
	const at = lines.findLastIndex((line) => !isBlank(line));
	if (at === -1) return [...lines];
	if (!/^(Took|Elapsed) [\d.]/u.test(stripTerminalSequences(lines[at] ?? "").trim()))
		return [...lines];
	return lines.slice(0, at);
}

interface Clock {
	startedAt?: number;
	endedAt?: number;
}

/** Pi shares one state object between the two halves of a call. */
function clockOf(context: { state: unknown }): Clock {
	return context.state as Clock;
}

function elapsedOf(clock: Clock): string | undefined {
	if (clock.startedAt === undefined || clock.endedAt === undefined) return undefined;
	return elapsed(clock.endedAt - clock.startedAt);
}

function elapsed(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const total = Math.floor(seconds);
	if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
	return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

/** The bottom rule of a call that ended: how it went, and how long it took. */
function bottomLabel(
	theme: Theme,
	mark: string,
	color: "accent" | "success" | "error",
	state: FrameState,
	time: string | undefined,
): string {
	const line = `${theme.fg(color, mark)} ${theme.fg("muted", state)}`;
	return time === undefined ? line : `${line}  ${theme.fg("dim", time)}`;
}

function inside(lines: readonly string[], width: number, theme: Theme): string[] {
	const paint = (text: string) => theme.fg("border", text);
	const inner = room(width);
	return trim(lines).map((line) => {
		// Measuring is cheap, and cutting a line that already fits is not.
		const text = visibleWidth(line) > inner ? truncateToWidth(line, inner, "\u2026", true) : line;
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));
		return `${paint("\u2502")} ${text}${pad} ${paint("\u2502")}`;
	});
}

interface Drawn {
	width: number;
	body: readonly string[];
	/** What the frame drew around the body: the ruling, the state, the time. */
	rest: readonly unknown[];
	lines: string[];
}

/** Whether the frame was already drawn for this body and this state, which keeps typing cheap. */
function unchanged(drawn: Drawn | undefined, next: Omit<Drawn, "lines">): drawn is Drawn {
	if (drawn === undefined || drawn.width !== next.width) return false;
	if (drawn.body.length !== next.body.length || drawn.rest.length !== next.rest.length)
		return false;
	if (drawn.rest.some((part, index) => part !== next.rest[index])) return false;
	return drawn.body.every((line, index) => line === next.body[index]);
}

function room(width: number): number {
	return Math.max(1, width - BODY_PAD);
}

/** Pi's renderers pad their part with blank lines, which the frame does not need. */
function trim(lines: readonly string[]): string[] {
	let [from, to] = [0, lines.length];
	while (from < to && isBlank(lines[from])) from++;
	while (to > from && isBlank(lines[to - 1])) to--;
	return lines.slice(from, to);
}

function isBlank(line: string | undefined): boolean {
	// A line of nothing but colour codes reads as blank, and pi's renderers end their parts with one.
	return stripTerminalSequences(line ?? "").trim() === "";
}

export function rulingText(ruling: CallRuling, theme: Theme, expanded: boolean): string {
	const color = STATE_COLORS[stateOf(ruling.tone)];
	let line = `${theme.fg(color, "\u25c8")} ${theme.fg(color, ruling.head)}`;
	if (ruling.note) line += ` ${theme.fg("accent", "\u203a")} ${ruling.note}`;
	if (ruling.why) line += `  ${theme.fg("muted", ruling.why)}`;
	if (expanded && ruling.detail) line += ` ${theme.fg("dim", `(${ruling.detail})`)}`;
	return line;
}

function stateOf(tone: RulingTone): FrameState {
	switch (tone) {
		case "pending":
			return "running";
		case "success":
			return "done";
		default:
			return "failed";
	}
}
