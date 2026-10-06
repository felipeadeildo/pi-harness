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
}

type Tint = "accent" | "warning" | "success" | "dim" | "muted" | "text";

interface Line {
	text: string;
	/** The item the line belongs to, for the cursor's highlight. */
	item?: string;
}

const PAD = 2;
const POINTER = "\u276f";

export class TimelineView implements Component {
	readonly #options: TimelineViewOptions;
	#selected: string | undefined;
	#offset = 0;
	#dropped = false;
	#allNotes = false;
	#page = 10;

	constructor(options: TimelineViewOptions) {
		this.#options = options;
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
		else if (data === "n") this.#allNotes = !this.#allNotes;
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

		const inner = Math.max(10, width - 2 - PAD * 2);
		const body = this.#body(goal, inner);
		const room = Math.max(3, this.#options.rows() - 4);
		this.#page = Math.max(1, room - 2);
		this.#follow(body, room);
		const shown = body.slice(this.#offset, this.#offset + room);

		const panel = backgroundAnsi(panelColor(theme), theme.getColorMode());
		const picked = theme.getBgAnsi("selectedBg");
		const side = theme.fg("border", "\u2502");
		const row = (line: Line) => {
			const on = line.item !== undefined && line.item === this.#selected;
			const text = truncateToWidth(line.text, inner, "\u2026", true);
			const pad = " ".repeat(PAD);
			const fill = on ? `${picked}${pad}${text}${pad}${panel}` : `${pad}${text}${pad}`;
			return `${panel}${side}${fill}${side}\x1b[49m`;
		};
		// The corner cells keep the chat's background, so the panel's corners read as round.
		const edge = (line: string) => {
			const inside = sliceByColumn(line, 1, width - 2);
			const first = sliceByColumn(line, 0, 1);
			const last = sliceByColumn(line, width - 1, 1);
			return `${first}${panel}${inside}\x1b[49m${last}`;
		};
		return [
			edge(this.#top(goal, width)),
			row({ text: "" }),
			...shown.map(row),
			row({ text: this.#scrollHint(body.length, room) }),
			edge(this.#bottom(width)),
		];
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
		const stem = theme.fg("border", last || on ? "   " : "\u2502  ");
		const meta = timeOf(item);
		const metaWidth = meta === "" ? 0 : visibleWidth(meta) + 2;
		const textWidth = Math.max(8, width - 5 - metaWidth);
		const closed = item.status === "done" || item.status === "dropped";
		const ink: Tint = on ? "text" : closed ? "muted" : "text";
		const words = (text: string) => (on ? theme.bold(theme.fg(ink, text)) : theme.fg(ink, text));

		const [first = "", ...rest] = wrapTextWithAnsi(item.text, textWidth);
		const head = `${branch}${theme.fg(color, mark)} ${words(first)}`;
		const gap = Math.max(2, width - visibleWidth(head) - visibleWidth(meta));
		const text = meta === "" ? head : `${head}${" ".repeat(gap)}${theme.fg("dim", meta)}`;
		const lines: Line[] = [{ text, item: item.id }];
		for (const line of rest) lines.push({ text: `${stem}  ${words(line)}`, item: item.id });
		if (item.note !== undefined && (on || this.#allNotes))
			for (const line of wrapTextWithAnsi(item.note, textWidth))
				lines.push({ text: `${stem}  ${theme.fg("dim", line)}`, item: item.id });
		return lines;
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
		const notes = this.#allNotes ? "n fewer notes" : "n all notes";
		const keys = theme.fg("dim", ` \u2191\u2193 move  ${notes}  d dropped  esc close `);
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

function timeOf(item: GoalItem): string {
	if (item.status === "now" && item.started !== undefined) return `since ${clock(item.started.at)}`;
	if (item.status === "done" || item.status === "dropped")
		return item.finished === undefined ? "" : clock(item.finished.at);
	return "";
}

function clock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fillBetween(left: string, right: string, width: number, theme: Theme): string {
	const fill = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
	return truncateToWidth(`${left}${theme.fg("border", "\u2500".repeat(fill))}${right}`, width, "");
}
