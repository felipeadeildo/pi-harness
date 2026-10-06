// Alt+G: the session's timeline as a tree, over the chat, updating while it is open.
import { type GoalItem, itemsWith, nowOf, type SessionGoal } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export const MARKS = { now: "\u2316", later: "\u29d7", done: "\u2713", dropped: "\u00d7" } as const;

export interface TimelineViewOptions {
	theme: Theme;
	state: () => SessionGoal;
	spent: () => { cost: number; calls: number };
	/** Rows the terminal has, to keep the frame on screen. */
	rows: () => number;
	close: () => void;
	requestRender: () => void;
}

const PAD = 2;

export class TimelineView implements Component {
	readonly #options: TimelineViewOptions;
	#offset = 0;
	#dropped = false;
	#page = 10;

	constructor(options: TimelineViewOptions) {
		this.#options = options;
	}

	handleInput(data: string): void {
		const { close, requestRender } = this.#options;
		if (
			matchesKey(data, "escape") ||
			matchesKey(data, "enter") ||
			matchesKey(data, "alt+g") ||
			data === "q"
		)
			return close();
		if (matchesKey(data, "up") || data === "k") this.#offset--;
		else if (matchesKey(data, "down") || data === "j") this.#offset++;
		else if (matchesKey(data, "pageUp")) this.#offset -= this.#page;
		else if (matchesKey(data, "pageDown") || data === " ") this.#offset += this.#page;
		else if (matchesKey(data, "home") || data === "g") this.#offset = 0;
		else if (matchesKey(data, "end") || data === "G") this.#offset = Number.MAX_SAFE_INTEGER;
		else if (data === "d") this.#dropped = !this.#dropped;
		else return;
		requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { theme, state } = this.#options;
		const goal = state();
		const inner = Math.max(10, width - 2 - PAD * 2);
		const body = this.#body(goal, inner);

		// Two border lines and a blank line above and below the body.
		const room = Math.max(3, this.#options.rows() - 4);
		this.#page = Math.max(1, room - 1);
		const last = Math.max(0, body.length - room);
		this.#offset = Math.min(Math.max(0, this.#offset), last);
		const shown = body.slice(this.#offset, this.#offset + room);

		const side = theme.fg("border", "\u2502");
		const pad = " ".repeat(PAD);
		const row = (line: string) =>
			`${side}${pad}${truncateToWidth(line, inner, "\u2026", true)}${pad}${side}`;
		return [
			this.#top(goal, width),
			row(""),
			...shown.map(row),
			row(this.#scrollHint(body.length, room)),
			this.#bottom(width),
		];
	}

	#body(goal: SessionGoal, width: number): string[] {
		const { theme } = this.#options;
		const now = nowOf(goal);
		const later = itemsWith(goal, "later");
		const done = itemsWith(goal, "done").toReversed();
		const dropped = this.#dropped ? itemsWith(goal, "dropped").toReversed() : [];
		if (now === undefined && later.length + done.length + dropped.length === 0)
			return [
				theme.fg("muted", "Nothing tracked yet."),
				theme.fg("dim", "The timeline fills in from your next message."),
			];

		const lines: string[] = [];
		const section = (title: string, items: readonly GoalItem[], color: Tint, mark: string) => {
			if (lines.length > 0) lines.push("");
			const count = title === "Now" ? "" : `  ${theme.fg("dim", String(items.length))}`;
			lines.push(`${theme.bold(theme.fg(color, title))}${count}`);
			items.forEach((item, index) =>
				lines.push(...this.#item(item, index === items.length - 1, color, mark, width)),
			);
		};
		section("Now", now === undefined ? [] : [now], "accent", MARKS.now);
		if (now === undefined) lines.push(theme.fg("dim", "\u2514\u2500 nothing under way"));
		if (later.length > 0) section("Later", later, "warning", MARKS.later);
		if (done.length > 0) section("Done", done, "success", MARKS.done);
		if (dropped.length > 0) section("Dropped", dropped, "dim", MARKS.dropped);
		return lines;
	}

	#item(item: GoalItem, last: boolean, color: Tint, mark: string, width: number): string[] {
		const { theme } = this.#options;
		const branch = theme.fg("border", last ? "\u2514\u2500 " : "\u251c\u2500 ");
		const stem = theme.fg("border", last ? "   " : "\u2502  ");
		const meta = timeOf(item);
		const metaWidth = meta === "" ? 0 : visibleWidth(meta) + 2;
		const textWidth = Math.max(8, width - 5 - metaWidth);
		const ink: Tint = item.status === "done" || item.status === "dropped" ? "muted" : "text";

		const [first = "", ...rest] = wrapTextWithAnsi(item.text, textWidth);
		const head = `${branch}${theme.fg(color, mark)} ${theme.fg(ink, first)}`;
		const gap = Math.max(2, width - visibleWidth(head) - visibleWidth(meta));
		const lines = [meta === "" ? head : `${head}${" ".repeat(gap)}${theme.fg("dim", meta)}`];
		for (const line of rest) lines.push(`${stem}  ${theme.fg(ink, line)}`);
		if (item.note !== undefined)
			for (const line of wrapTextWithAnsi(item.note, textWidth))
				lines.push(`${stem}  ${theme.fg("dim", line)}`);
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
		const keys = theme.fg("dim", ` \u2191\u2193 scroll  d dropped  esc close `);
		const { cost, calls } = spent();
		const money = calls === 0 ? "" : theme.fg("dim", ` $${cost.toFixed(3)}, ${calls} calls `);
		const left = `${theme.fg("border", "\u2570\u2500")}${keys}`;
		const right = `${money}${theme.fg("border", "\u2500\u256f")}`;
		return fillBetween(left, right, width, theme);
	}

	#scrollHint(total: number, room: number): string {
		if (total <= room) return "";
		const below = total - room - this.#offset;
		const text = below > 0 ? `\u2193 ${below} more` : `\u2191 top`;
		return this.#options.theme.fg("dim", text);
	}
}

type Tint = "accent" | "warning" | "success" | "dim" | "muted" | "text";

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
