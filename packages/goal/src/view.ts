// Alt+G: the session's timeline as a tree over the chat, with a cursor on one item at a time.
import { type GoalItem, itemsWith, nowOf, type SessionGoal } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	backgroundAnsi,
	colorToOkhsl,
	type Component,
	matchesKey,
	okhslColor,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export const MARKS = { now: "\u2316", later: "\u29d7", done: "\u2713", dropped: "\u00d7" } as const;

export interface TimelineViewOptions {
	theme: Theme;
	state: () => SessionGoal;
	spent: () => { cost: number; calls: number };
	/** Rows the panel may take. */
	rows: () => number;
	close: () => void;
	requestRender: () => void;
	/** How a time reads. The local clock by default; the docs pin it, so a picture never moves. */
	clock?: Clock;
}

type Clock = (at: number) => string;

type Tint = "accent" | "warning" | "success" | "dim" | "muted" | "text";

interface Line {
	text: string;
	/** The item the line belongs to, for the cursor's highlight. */
	item?: string;
}

const PAD = 2;
const POINTER = "\u276f";
const DETAIL_LINES = 3;

export class TimelineView implements Component {
	readonly #options: TimelineViewOptions;
	readonly #clock: Clock;
	#selected: string | undefined;
	#offset = 0;
	#dropped = false;
	#room = 0;
	#page = 10;

	constructor(options: TimelineViewOptions) {
		this.#options = options;
		this.#clock = options.clock ?? localClock;
	}

	handleInput(data: string): void {
		const { close, requestRender } = this.#options;
		if (matchesKey(data, "escape") || matchesKey(data, "alt+g") || data === "q") return close();
		if (matchesKey(data, "up") || data === "k") this.#step(-1);
		else if (matchesKey(data, "down") || data === "j") this.#step(1);
		else if (matchesKey(data, "pageUp")) this.#step(-this.#page);
		else if (matchesKey(data, "pageDown")) this.#step(this.#page);
		else if (matchesKey(data, "home") || data === "g") this.#step(-Infinity);
		else if (matchesKey(data, "end") || data === "G") this.#step(Infinity);
		else if (data === "d") this.#dropped = !this.#dropped;
		else return;
		requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { theme } = this.#options;
		const goal = this.#options.state();
		const items = this.#items(goal);
		if (this.#selected === undefined || !items.some((item) => item.id === this.#selected))
			this.#selected = items[0]?.id;
		const selected = items.find((item) => item.id === this.#selected);

		const inner = Math.max(10, width - 2 - PAD * 2);
		const body = this.#body(goal, inner);
		// Borders, a blank line, the scroll hint, the divider and the detail pane.
		const chrome = 5 + DETAIL_LINES;
		const most = Math.max(3, this.#options.rows() - chrome);
		// The panel never shrinks while open, so moving the cursor never moves the frame.
		this.#room = Math.min(most, Math.max(this.#room, body.length));
		const room = this.#room;
		this.#page = Math.max(1, room - 2);
		this.#follow(body, room);
		const shown = body.slice(this.#offset, this.#offset + room);
		while (shown.length < room) shown.push({ text: "" });

		const panel = backgroundAnsi(panelColor(theme), theme.getColorMode());
		const picked = theme.getBgAnsi("selectedBg");
		const side = theme.fg("border", "\u2502");
		const pad = " ".repeat(PAD);
		const row = (line: Line) => {
			const on = line.item !== undefined && line.item === this.#selected;
			const text = keepBackground(
				truncateToWidth(line.text, inner, "\u2026", true),
				on ? picked : panel,
			);
			const fill = on ? `${picked}${pad}${text}${pad}${panel}` : `${pad}${text}${pad}`;
			return `${panel}${side}${fill}${side}\x1b[49m`;
		};
		// The corner cells keep the chat's background, so the panel's corners read as round.
		const edge = (line: string) => {
			const inside = keepBackground(sliceByColumn(line, 1, width - 2), panel);
			const first = sliceByColumn(line, 0, 1);
			const last = sliceByColumn(line, width - 1, 1);
			return `${first}${panel}${inside}\x1b[49m${last}`;
		};
		const divider = `${panel}${theme.fg("border", `\u251c${"\u2500".repeat(width - 2)}\u2524`)}\x1b[49m`;
		return [
			edge(this.#top(goal, width)),
			row({ text: "" }),
			...shown.map(row),
			row({ text: this.#scrollHint(body.length, room) }),
			divider,
			...this.#detail(selected, inner).map((text) => row({ text })),
			edge(this.#bottom(width)),
		];
	}

	/** The item under the cursor in full: its whole text and its note, in a pane of fixed height. */
	#detail(item: GoalItem | undefined, width: number): string[] {
		const { theme } = this.#options;
		const lines: string[] = [];
		if (item !== undefined) {
			lines.push(...wrapTextWithAnsi(theme.fg("text", item.text), width));
			const note = item.note === undefined ? [] : wrapTextWithAnsi(item.note, width);
			lines.push(...note.map((line) => theme.fg("muted", line)));
			const when = whenOf(item, this.#clock);
			if (when !== "" && lines.length < DETAIL_LINES) lines.push(theme.fg("dim", when));
		}
		const kept = lines.slice(0, DETAIL_LINES);
		if (lines.length > DETAIL_LINES) kept[DETAIL_LINES - 1] = `${kept[DETAIL_LINES - 1]}\u2026`;
		while (kept.length < DETAIL_LINES) kept.push("");
		return kept;
	}

	/** Items in the order they are drawn, which the cursor walks. */
	#items(goal: SessionGoal): GoalItem[] {
		const now = nowOf(goal);
		return [
			...(now === undefined ? [] : [now]),
			...itemsWith(goal, "later"),
			...newestFirst(itemsWith(goal, "done")),
			...(this.#dropped ? newestFirst(itemsWith(goal, "dropped")) : []),
		];
	}

	#step(by: number): void {
		const items = this.#items(this.#options.state());
		if (items.length === 0) return;
		const at = items.findIndex((item) => item.id === this.#selected);
		const next = Math.min(items.length - 1, Math.max(0, (at === -1 ? 0 : at) + by));
		this.#selected = items[next]?.id;
	}

	/** Scrolls just enough to keep the cursor's item in view. */
	#follow(body: readonly Line[], room: number): void {
		const first = body.findIndex((line) => line.item === this.#selected);
		const last = body.findLastIndex((line) => line.item === this.#selected);
		if (first !== -1) {
			// The section title above the first item comes into view with it.
			const top = body[first - 1]?.item === undefined ? first - 1 : first;
			if (top < this.#offset) this.#offset = Math.max(0, top);
			if (last >= this.#offset + room) this.#offset = last - room + 1;
		}
		this.#offset = Math.min(Math.max(0, this.#offset), Math.max(0, body.length - room));
	}

	#body(goal: SessionGoal, width: number): Line[] {
		const { theme } = this.#options;
		const now = nowOf(goal);
		const later = itemsWith(goal, "later");
		const done = newestFirst(itemsWith(goal, "done"));
		const dropped = this.#dropped ? newestFirst(itemsWith(goal, "dropped")) : [];
		if (now === undefined && later.length + done.length + dropped.length === 0)
			return [
				{ text: theme.fg("muted", "Nothing tracked yet.") },
				{ text: theme.fg("dim", "The timeline fills in from your next message.") },
			];

		const lines: Line[] = [];
		const section = (title: string, items: readonly GoalItem[], color: Tint, mark: string) => {
			if (lines.length > 0) lines.push({ text: "" });
			const count = title === "Now" ? "" : `  ${theme.fg("dim", String(items.length))}`;
			lines.push({ text: `${theme.bold(theme.fg(color, title))}${count}` });
			items.forEach((item, index) =>
				lines.push(...this.#item(item, index === items.length - 1, color, mark, width)),
			);
		};
		section("Now", now === undefined ? [] : [now], "accent", MARKS.now);
		if (now === undefined) lines.push({ text: theme.fg("dim", "\u2514\u2500 nothing under way") });
		if (later.length > 0) section("Later", later, "warning", MARKS.later);
		if (done.length > 0) section("Done", done, "success", MARKS.done);
		if (dropped.length > 0) section("Dropped", dropped, "dim", MARKS.dropped);
		return lines;
	}

	#item(item: GoalItem, last: boolean, color: Tint, mark: string, width: number): Line[] {
		const { theme } = this.#options;
		const on = item.id === this.#selected;
		const branch = on
			? theme.fg("accent", `${POINTER}  `)
			: theme.fg("border", last ? "\u2514\u2500 " : "\u251c\u2500 ");
		const meta = timeOf(item, this.#clock);
		const metaWidth = meta === "" ? 0 : visibleWidth(meta) + 2;
		const closed = item.status === "done" || item.status === "dropped";
		const ink: Tint = on || !closed ? "text" : "muted";
		const plain = truncateToWidth(item.text, Math.max(8, width - 5 - metaWidth), "\u2026");
		const words = on ? theme.bold(theme.fg(ink, plain)) : theme.fg(ink, plain);
		const head = `${branch}${theme.fg(color, mark)} ${words}`;
		const gap = Math.max(2, width - visibleWidth(head) - visibleWidth(meta));
		const text = meta === "" ? head : `${head}${" ".repeat(gap)}${theme.fg("dim", meta)}`;
		return [{ text, item: item.id }];
	}

	#top(goal: SessionGoal, width: number): string {
		const { theme } = this.#options;
		const counts = [
			theme.fg("success", `${MARKS.done} ${itemsWith(goal, "done").length}`),
			theme.fg("warning", `${MARKS.later} ${itemsWith(goal, "later").length}`),
		].join("  ");
		const titleRoom = Math.max(4, width - visibleWidth(counts) - 10);
		const title = truncateToWidth(goal.goal ?? "This session", titleRoom, "\u2026");
		const left = `${theme.fg("border", "\u256d\u2500 ")}${theme.bold(theme.fg("accent", title))} `;
		const right = ` ${counts}${theme.fg("border", " \u2500\u256e")}`;
		return fillBetween(left, right, width, theme);
	}

	#bottom(width: number): string {
		const { theme, spent } = this.#options;
		const keys = theme.fg("dim", ` \u2191\u2193 move  d dropped  esc close `);
		const { cost, calls } = spent();
		const money = calls === 0 ? "" : theme.fg("dim", ` $${cost.toFixed(3)}, ${calls} calls `);
		const left = `${theme.fg("border", "\u2570\u2500")}${keys}`;
		const right = `${money}${theme.fg("border", "\u2500\u256f")}`;
		return fillBetween(left, right, width, theme);
	}

	#scrollHint(total: number, room: number): string {
		if (total <= room) return "";
		const below = total - room - this.#offset;
		const text = below > 0 ? `\u2193 ${below} more` : "\u2191 top";
		return this.#options.theme.fg("dim", text);
	}
}

/** A cut line ends in a full reset, which would drop the background it sits on. */
function keepBackground(text: string, background: string): string {
	return text.replaceAll("\x1b[0m", `\x1b[0m${background}`);
}

/** A solid panel in the border's hue, so the chat behind it does not read as part of it. */
function panelColor(theme: Theme) {
	const { h, s } = colorToOkhsl(theme.colors.border);
	return theme.appearance === "dark" ? okhslColor(h, s * 0.35, 0.14) : okhslColor(h, s * 0.3, 0.96);
}

function newestFirst(items: readonly GoalItem[]): GoalItem[] {
	return items.toSorted((left, right) => finishedAt(right) - finishedAt(left));
}

function finishedAt(item: GoalItem): number {
	return item.finished?.at ?? item.updatedAt;
}

function timeOf(item: GoalItem, clock: Clock): string {
	if (item.status === "now" && item.started !== undefined) return `since ${clock(item.started.at)}`;
	if (item.status === "done" || item.status === "dropped")
		return item.finished === undefined ? "" : clock(item.finished.at);
	return "";
}

function whenOf(item: GoalItem, clock: Clock): string {
	const started = item.started === undefined ? "" : `started ${clock(item.started.at)}`;
	const finished = item.finished === undefined ? "" : `${item.status} ${clock(item.finished.at)}`;
	return [started, finished].filter((part) => part !== "").join(", ");
}

function localClock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fillBetween(left: string, right: string, width: number, theme: Theme): string {
	const fill = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
	return truncateToWidth(`${left}${theme.fg("border", "\u2500".repeat(fill))}${right}`, width, "");
}
