// The accounts of one provider in our frame: which one is in use, what each plan has left, and the
// keys to switch, rename, remove or add one. Renaming and removing happen in place, so the list stays
// where it is and says what changed.
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	type KeyId,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { UsageWindow } from "../usage/types.ts";
import { frameBottom, frameInner, frameRow, frameTop } from "./frame.ts";
import { quotaWindows } from "./quota.ts";

/** What a row says past the account's name: its plan, or the trouble it is in. */
export type AccountState =
	| { kind: "quota"; windows: readonly UsageWindow[] }
	| { kind: "reading" }
	| { kind: "signIn" }
	| { kind: "spent"; resetsIn: string }
	| { kind: "quiet" };

export interface AccountRow {
	id: string;
	label: string;
	/** `subscription` or `api key`. */
	kind: string;
	inUse: boolean;
	state: AccountState;
}

/** What closes the list: an account to use or to sign in again, or a new one to add. */
export type AccountsChoice =
	| { kind: "use"; id: string }
	| { kind: "signIn"; id: string }
	| { kind: "add" };

export interface AccountsListing {
	/** The provider as pi names it, like `Anthropic`. */
	provider: string;
	/** Read on every frame, so a plan that arrives late fills its row in. */
	rows(): readonly AccountRow[];
	/** What an empty list means, and what adding one does. */
	empty: string;
	/** Renames in place, answering with a problem or undefined. */
	rename(id: string, label: string): string | undefined;
	/** Removes in place, answering with a problem or undefined. */
	remove(id: string): string | undefined;
	/** What removing asks, which says so when it is the last account. */
	removeQuestion(row: AccountRow): string;
}

type Mode = { kind: "browse" } | { kind: "rename"; id: string } | { kind: "remove"; id: string };

interface Note {
	text: string;
	tone: "success" | "error";
}

/** The widths of the name and kind columns; a kind of 0 means the plan took its room. */
interface Columns {
	name: number;
	kind: number;
}

/** The add row's place in the list, which no account id can take. */
const ADD = Symbol("add");
type Item = string | typeof ADD;

const POINTER = "\u276f ";
const IN_USE = "in use";
const MAX_VISIBLE = 8;
const GAP = "  ";
const NAME_LIMIT = 24;
/** Ctrl+E, which the input reads as the end of the line: a rename starts after the old name. */
const LINE_END = "\u0005";

/** Opens the list, resolving with what the person chose, or undefined when it closed. */
export async function showAccounts(
	ctx: ExtensionContext,
	listing: AccountsListing,
	ready?: Promise<unknown>,
): Promise<AccountsChoice | undefined> {
	return await ctx.ui.custom<AccountsChoice | undefined>((tui, theme, _keybindings, done) => {
		const view = new AccountsView(tui, theme, listing, done);
		// The plans are read in the background, and their rows fill in when they arrive.
		void ready?.then(
			() => view.refresh(),
			() => view.refresh(),
		);
		return view;
	});
}

export class AccountsView implements Component, Focusable {
	private readonly input = new Input({ prompt: "" });
	private hasFocus = false;
	private cursor: Item;
	private mode: Mode = { kind: "browse" };
	private note: Note | undefined;
	private closed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly listing: AccountsListing,
		private readonly done: (choice: AccountsChoice | undefined) => void,
	) {
		const rows = listing.rows();
		this.cursor = rows.find((row) => row.inUse)?.id ?? rows[0]?.id ?? ADD;
	}

	get focused(): boolean {
		return this.hasFocus;
	}

	/** The field takes the focus along, so the terminal's cursor sits in a name being typed. */
	set focused(value: boolean) {
		this.hasFocus = value;
		this.input.focused = value;
	}

	/** Draws again, for a plan that arrived after the list opened. */
	refresh(): void {
		if (!this.closed) this.tui.requestRender();
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.closed) return;
		if (this.mode.kind === "rename") this.renaming(data, this.mode.id);
		else if (this.mode.kind === "remove") this.removing(data, this.mode.id);
		else this.browsing(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const inner = frameInner(width);
		const rows = this.listing.rows();
		const items = itemsOf(rows);
		const at = this.indexOf(items);
		const { start, end } = visible(at, items.length);
		const states = new Map(rows.map((row) => [row.id, describeState(this.theme, row.state)]));
		const columns = this.columns(rows, [...states.values()], inner);

		const lines: string[] = [];
		if (rows.length === 0) lines.push(this.theme.fg("muted", this.listing.empty), "");
		for (const item of items.slice(start, end)) {
			const row = rows.find((candidate) => candidate.id === item);
			const state = row === undefined ? "" : (states.get(row.id) ?? "");
			lines.push(row === undefined ? this.addLine() : this.accountLine(row, columns, state, inner));
		}
		lines.push("");
		const status = this.statusLine(rows);
		if (status !== undefined) lines.push(status);
		const position = start > 0 || end < items.length ? `${at + 1}/${items.length}` : undefined;
		lines.push(this.hint(rows, position));

		return [
			frameTop(this.theme, `${this.listing.provider} accounts`, width),
			...lines.map((line) => frameRow(this.theme, line, inner)),
			frameBottom(this.theme, width),
		];
	}

	private browsing(data: string): void {
		const rows = this.listing.rows();
		const items = itemsOf(rows);
		const at = this.indexOf(items);
		const row = rows.find((candidate) => candidate.id === this.cursor);

		if (pressed(data, Key.up, "k"))
			this.cursor = items[(at - 1 + items.length) % items.length] ?? ADD;
		else if (pressed(data, Key.down, "j")) this.cursor = items[(at + 1) % items.length] ?? ADD;
		else if (pressed(data, Key.home)) this.cursor = items[0] ?? ADD;
		else if (pressed(data, Key.end)) this.cursor = ADD;
		else if (pressed(data, Key.enter)) {
			if (row === undefined) this.close({ kind: "add" });
			else if (row.state.kind === "signIn") this.close({ kind: "signIn", id: row.id });
			else this.close({ kind: "use", id: row.id });
		} else if (pressed(data, "a")) this.close({ kind: "add" });
		else if (pressed(data, "r") && row !== undefined) {
			this.note = undefined;
			this.input.setValue(row.label);
			this.input.handleInput(LINE_END);
			this.mode = { kind: "rename", id: row.id };
		} else if (pressed(data, "d", Key.delete) && row !== undefined) {
			this.note = undefined;
			this.mode = { kind: "remove", id: row.id };
		} else if (pressed(data, Key.escape, Key.ctrl("c"), "q")) this.close(undefined);
	}

	private renaming(data: string, id: string): void {
		if (pressed(data, Key.escape, Key.ctrl("c"))) {
			this.mode = { kind: "browse" };
			return;
		}
		if (!pressed(data, Key.enter)) {
			this.input.handleInput(data);
			return;
		}
		const label = this.input.getValue().trim();
		// An empty name is no name: the field waits for one.
		if (label === "") return;
		const before = this.listing.rows().find((row) => row.id === id)?.label;
		if (label !== before) {
			const problem = this.listing.rename(id, label);
			this.note =
				problem === undefined
					? { text: `Renamed to ${label}`, tone: "success" }
					: { text: problem, tone: "error" };
		}
		this.mode = { kind: "browse" };
	}

	private removing(data: string, id: string): void {
		if (pressed(data, Key.escape, Key.ctrl("c"), "n")) {
			this.mode = { kind: "browse" };
			return;
		}
		if (!pressed(data, Key.enter, "y")) return;

		const before = this.listing.rows();
		const at = before.findIndex((row) => row.id === id);
		const label = before[at]?.label ?? "";
		const problem = this.listing.remove(id);
		this.mode = { kind: "browse" };
		if (problem !== undefined) {
			this.note = { text: problem, tone: "error" };
			return;
		}
		this.note = { text: `Removed ${label}`, tone: "success" };
		// The cursor stays where the row was, on whatever took its place.
		const after = this.listing.rows();
		this.cursor = after[Math.min(at, after.length - 1)]?.id ?? ADD;
	}

	private close(choice: AccountsChoice | undefined): void {
		if (this.closed) return;
		this.closed = true;
		this.done(choice);
	}

	/** Where the cursor sits, or the first row when its account went away. */
	private indexOf(items: readonly Item[]): number {
		const at = items.indexOf(this.cursor);
		if (at >= 0) return at;
		this.cursor = items[0] ?? ADD;
		return 0;
	}

	/** Every column as wide as its widest cell. The kind gives its room away when the plan would not fit. */
	private columns(rows: readonly AccountRow[], states: readonly string[], inner: number): Columns {
		const typed = this.mode.kind === "rename" ? visibleWidth(this.input.getValue()) + 1 : 0;
		const name = Math.min(
			NAME_LIMIT,
			Math.max(typed, ...rows.map((row) => visibleWidth(row.label)), 4),
		);
		const kind = Math.max(0, ...rows.map((row) => visibleWidth(row.kind)));
		const state = Math.max(0, ...states.map((text) => visibleWidth(text)));
		const fixed = POINTER.length + name + GAP.length + IN_USE.length + GAP.length;
		const fits = fixed + kind + GAP.length + state <= inner;
		return { name, kind: fits ? kind : 0 };
	}

	private accountLine(row: AccountRow, columns: Columns, state: string, inner: number): string {
		const theme = this.theme;
		const chosen = row.id === this.cursor;
		const pointer = chosen ? theme.fg("accent", POINTER) : " ".repeat(POINTER.length);
		const name = pad(this.nameCell(row, chosen, columns.name), columns.name);
		const kind = columns.kind === 0 ? "" : `${pad(theme.fg("dim", row.kind), columns.kind)}${GAP}`;
		const use = pad(row.inUse ? theme.fg("success", IN_USE) : "", IN_USE.length);
		return truncateToWidth(`${pointer}${name}${GAP}${kind}${use}${GAP}${state}`, inner);
	}

	private nameCell(row: AccountRow, chosen: boolean, width: number): string {
		const editing = this.mode.kind !== "browse" && this.mode.id === row.id;
		// Pi's own field draws the cursor where it is and scrolls a name longer than the column.
		if (editing && this.mode.kind === "rename") return this.input.render(width)[0] ?? "";
		const label = truncateToWidth(row.label, NAME_LIMIT, "…");
		if (editing) return this.theme.fg("error", label);
		return chosen ? this.theme.bold(label) : label;
	}

	private addLine(): string {
		const chosen = this.cursor === ADD;
		const label = "+ Add an account";
		if (!chosen) return `${" ".repeat(POINTER.length)}${this.theme.fg("muted", label)}`;
		return `${this.theme.fg("accent", POINTER)}${this.theme.bold(this.theme.fg("accent", label))}`;
	}

	private statusLine(rows: readonly AccountRow[]): string | undefined {
		if (this.mode.kind === "remove") {
			const id = this.mode.id;
			const row = rows.find((candidate) => candidate.id === id);
			return row === undefined
				? undefined
				: this.theme.fg("warning", this.listing.removeQuestion(row));
		}
		if (this.note === undefined) return undefined;
		return this.theme.fg(this.note.tone, this.note.text);
	}

	private hint(rows: readonly AccountRow[], position: string | undefined): string {
		const row = rows.find((candidate) => candidate.id === this.cursor);
		let keys: [string, string][];
		if (this.mode.kind === "rename") {
			keys = [
				["enter", "save"],
				["esc", "cancel"],
			];
		} else if (this.mode.kind === "remove") {
			keys = [
				["enter", "remove"],
				["esc", "keep"],
			];
		} else if (row === undefined) {
			keys = [
				["↑↓", "move"],
				["enter", "add"],
				["esc", "close"],
			];
		} else {
			keys = [
				["↑↓", "move"],
				["enter", row.state.kind === "signIn" ? "sign in" : "use"],
				["r", "rename"],
				["d", "remove"],
				["a", "add"],
				["esc", "close"],
			];
		}
		const text = keys.map(
			([key, action]) => `${this.theme.fg("muted", key)} ${this.theme.fg("dim", action)}`,
		);
		if (position !== undefined) text.push(this.theme.fg("dim", position));
		return text.join("   ");
	}
}

/** What a row says past the account's name. The Alt+A picker shows the same words. */
export function describeState(theme: Theme, state: AccountState): string {
	switch (state.kind) {
		case "quota":
			return quotaWindows(theme, state.windows);
		case "reading":
			return theme.fg("dim", "reading the plan…");
		case "signIn":
			return theme.fg("error", "sign in again");
		case "spent":
			return theme.fg("warning", `spent, resets in ${state.resetsIn}`);
		case "quiet":
			return "";
	}
}

/** The rows' accounts in order, then the add row. */
function itemsOf(rows: readonly AccountRow[]): Item[] {
	return [...rows.map((row) => row.id), ADD];
}

/** True when the input is any of these keys. */
function pressed(data: string, ...keys: KeyId[]): boolean {
	return keys.some((key) => matchesKey(data, key));
}

/** The slice of the list that fits, keeping the cursor away from the edges. */
function visible(at: number, count: number): { start: number; end: number } {
	const start = Math.max(0, Math.min(at - Math.floor(MAX_VISIBLE / 2), count - MAX_VISIBLE));
	return { start, end: Math.min(start + MAX_VISIBLE, count) };
}

function pad(text: string, width: number): string {
	const clipped = truncateToWidth(text, width);
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}
