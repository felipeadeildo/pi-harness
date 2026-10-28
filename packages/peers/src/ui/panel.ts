import { basename } from "node:path";

// The `Alt+G` panel. The line you write in always has the keys, so what acts on a room or an agent
// holds alt.
import {
	CUT,
	FRAME_X,
	FRAME_Y,
	type FrameLine,
	frame,
	GLYPH,
	hideImagesUnderOverlays,
	type KeyHint,
	LINE,
	type RoomMode,
	pointer,
	type SourceAddress,
	spread,
} from "@adeildo/pi-kit";
import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { stateOf } from "../cards.ts";
import type { Peer } from "../folder.ts";
import type { Here } from "../here.ts";
import type { LiveSession, Room, RoomsView } from "../model.ts";
import { agentLines, inOrder, MARKS } from "./agents.ts";
import { FRAME_MS } from "./motion.ts";
import { GUTTER, Picker, scrolled, sessionRow } from "./picker.ts";
import { RoomView } from "./room.ts";

const FOLDER = "";
const SIDE_MIN = 24;
const SIDE_MAX = 34;
/** Narrower than this, one side at a time. */
const BESIDE = 72;

type Entry =
	| { kind: "room"; room: Room }
	| { kind: "agent"; room: Room; peer: Peer }
	| { kind: "folder"; room: Room; path: string; open: number };

export interface PanelOptions {
	theme: Theme;
	view: RoomsView;
	close: () => void;
	requestRender: () => void;
	rows: () => number;
	/** False when nothing can show it, and then `enter` writes to the agent instead. */
	show?: (session: string) => boolean;
	/** So the docs pictures do not depend on when they are drawn. */
	now?: () => number;
	clock?: (at: number) => string;
}

export class PeersPanel implements Component, Focusable {
	focused = false;

	readonly #options: PanelOptions;
	readonly #rooms = new Map<string, RoomView>();
	/** By key, so it stays put as rooms come and go. */
	#open = FOLDER;
	/** The agent or folder alt+↑↓ points at in the side column, by key; none while you only write. */
	#pointed: string | undefined;
	/** The pointed one's line in the side column, from the last drawing, so the column scrolls to it. */
	#pointedLine = 0;
	#closing: string | undefined;
	#picker: Picker | undefined;

	constructor(options: PanelOptions) {
		this.#options = options;
	}

	invalidate(): void {
		for (const room of this.#rooms.values()) room.invalidate();
		this.#picker?.invalidate();
	}

	moving(): boolean {
		const room = this.#roomView(this.#openRoom());
		const live = room?.here.live() ?? [];
		return live.some((peer) => stateOf(peer) === "running") || room?.moving() === true;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("g"))) return this.#options.close();
		if (this.#picker !== undefined) return this.#picker.handleInput(data);
		if (this.#closing !== undefined) return this.#confirm(data);
		const open = this.#openRoom();
		const room = this.#roomView(open);
		if (this.#roomKey(data, open)) return;
		if (room?.picking() === true && room.handleInput(data)) return;
		const agent = this.#pointedEntry();
		if (matchesKey(data, Key.escape) && agent !== undefined) return this.#point(undefined);
		if (matchesKey(data, Key.enter) && agent !== undefined && room?.empty() !== false)
			return this.#enter(agent);
		if (matchesKey(data, Key.tab)) return this.#switch(1);
		if (matchesKey(data, Key.shift("tab"))) return this.#switch(-1);
		if (room?.handleInput(data) === true) return;
		if (matchesKey(data, Key.escape)) this.#options.close();
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
		if (delta === 0) return undefined;
		this.#roomView(this.#openRoom())?.scroll(delta);
		return { handled: true };
	}

	#roomKey(data: string, open: Room | undefined): boolean {
		const { view } = this.#options;
		if (matchesKey(data, Key.alt("up"))) return this.#movePointer(-1);
		if (matchesKey(data, Key.alt("down"))) return this.#movePointer(1);
		if (matchesKey(data, Key.alt("c"))) return this.#did(() => this.#pick(undefined));
		if (open === undefined) return false;
		if (matchesKey(data, Key.alt("m")))
			return this.#did(() => this.#act(() => view.setMode(open.id, nextMode(open))));
		const agent = this.#pointedEntry();
		if (matchesKey(data, Key.alt("o")) && agent?.kind === "agent")
			return this.#did(() => this.#narrow(agent));
		const shared = open.id;
		if (shared === undefined) return false;
		if (matchesKey(data, Key.alt("a"))) return this.#did(() => this.#pick(open));
		if (matchesKey(data, Key.alt("l"))) return this.#did(() => this.#act(() => view.leave(shared)));
		if (matchesKey(data, Key.alt("x")))
			return this.#did(() => {
				this.#closing = shared;
				this.#options.requestRender();
			});
		if (matchesKey(data, Key.alt("r")) && agent !== undefined)
			return this.#did(() => this.#remove(shared, agent));
		return false;
	}

	#did(run: () => void): boolean {
		run();
		return true;
	}

	#remove(shared: string, entry: Entry): void {
		const { view } = this.#options;
		if (entry.kind === "folder") this.#act(() => view.remove(shared, { folder: entry.path }));
		else if (entry.kind === "agent" && entry.peer.session !== this.#me()) {
			const { session, cwd } = entry.peer;
			this.#act(() => view.remove(shared, { session, cwd: cwd ?? "" }));
		}
	}

	render(width: number): string[] {
		const { theme } = this.#options;
		const rooms = this.#options.view.rooms();
		const open = this.#openRoom();
		const inner = Math.max(20, width - FRAME_X);
		// The tabs and the line under them take two rows, and one empty row opens both columns.
		const height = Math.max(6, this.#options.rows() - FRAME_Y - 3);
		const beside = inner >= BESIDE;
		const side = beside ? Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.floor(inner * 0.28))) : 0;
		const main = beside ? inner - side - 3 : inner;
		const left = this.#mainLines(open, main, height);
		const actions = beside && open !== undefined ? this.#actionLines(open, side) : [];
		const listed = height - actions.length;
		const right = beside
			? [
					...fitted(scrolled(this.#sideLines(open, side), this.#pointedLine, listed).lines, listed),
					...actions,
				]
			: [];

		const column = theme.fg("borderMuted", LINE.v);
		const body: FrameLine[] = [];
		for (let line = -1; line < height; line++) {
			const text = left[line] ?? "";
			if (!beside) {
				body.push(text);
				continue;
			}
			const clipped = truncateToWidth(text, main, "");
			const gap = " ".repeat(Math.max(0, main - visibleWidth(clipped)));
			body.push(`${clipped}${gap} ${column}${line < 0 ? "" : ` ${right[line] ?? ""}`}`);
		}
		const current = Math.max(
			0,
			rooms.findIndex((room) => open !== undefined && keyOf(room) === keyOf(open)),
		);
		return frame(theme, width, body, {
			title: "Rooms",
			status: this.#status(open),
			tabs: { titles: rooms.map((room, index) => this.#tab(room, index === current)), current },
			keys: this.#keys(open),
			split: beside ? main + 1 : undefined,
			border: "borderMuted",
		});
	}

	#tab(room: Room, open: boolean): string {
		const { theme } = this.#options;
		const badge = this.#badge(room);
		const name = open ? theme.bold(theme.fg("accent", room.name)) : theme.fg("muted", room.name);
		return `${this.#mark(room.mode)} ${name}${badge === "" ? "" : ` ${badge}`}`;
	}

	/** Who is in the open room, then its folders; alt+↑↓ points at one. */
	#sideLines(open: Room | undefined, width: number): string[] {
		const { theme } = this.#options;
		const here = open === undefined ? undefined : this.#options.view.here(open.id);
		if (open === undefined || here === undefined) return [];
		const live = inOrder(here.live(), here.session);
		const pointed = this.#pointed;
		const selected = live.findIndex((peer) => peer.session === pointed);
		const self = here.session === undefined ? undefined : here.names().bySession.get(here.session);
		const lines = [
			...this.#selfLines(open, self?.handle, width),
			"",
			GUTTER + heading(theme, "Agents", live.length),
		];
		const agents = agentLines(live, here.names().bySession, {
			theme,
			now: this.#now(),
			me: here.session,
			selected,
			width,
			focused: true,
			compact: true,
			indent: 0,
		});
		this.#pointedLine = selected >= 0 ? lines.length + agents.selectedAt : 0;
		lines.push(...agents.lines);
		const folders = open.id === undefined ? [] : open.folders;
		if (folders.length > 0) lines.push("", GUTTER + heading(theme, "Folders", folders.length));
		for (const folder of folders) {
			const isPointed = pointed === folderKey(folder.path);
			if (isPointed) this.#pointedLine = lines.length;
			const left = `${pointer(theme, isPointed)}${theme.fg("muted", `${basename(folder.path)}/`)}`;
			lines.push(spread(left, theme.fg("dim", `${folder.open} open`), width));
		}
		return lines;
	}

	/** How this session stands in the open room, in words, since the tab shows it only as a mark. */
	#selfLines(open: Room, handle: string | undefined, width: number): string[] {
		const { theme } = this.#options;
		const { verb, means } = MODES[open.mode];
		const who = handle === undefined ? "This session" : theme.bold(handle);
		const color: ThemeColor = open.mode === "in" ? "accent" : "muted";
		const fit = (text: string): string => truncateToWidth(text, width, CUT);
		return [
			GUTTER + heading(theme, "This session"),
			fit(`${GUTTER}${this.#mark(open.mode)} ${who} ${theme.fg(color, verb)}`),
			...wrapTextWithAnsi(means, Math.max(1, width - 4)).map(
				(line) => `    ${theme.fg("dim", line)}`,
			),
			fit(`    ${theme.fg("muted", "alt+m")} ${theme.fg("dim", `${modeKey(open)} instead`)}`),
		];
	}

	#actionLines(open: Room, width: number): string[] {
		const { theme } = this.#options;
		const key = (keys: string, does: string): string =>
			truncateToWidth(`${GUTTER}${theme.fg("muted", keys)} ${theme.fg("dim", does)}`, width, "");
		const lines = ["", GUTTER + heading(theme, "This room")];
		if (open.id !== undefined)
			lines.push(key("alt+a", "add someone"), key("alt+l", "leave"), key("alt+x", "close it"));
		lines.push(key("alt+c", "new room"));
		return lines;
	}

	#mark(mode: RoomMode): string {
		const { theme } = this.#options;
		if (mode === "listening") return theme.fg("muted", GLYPH.half);
		return mode === "out" ? theme.fg("dim", GLYPH.ring) : theme.fg("accent", GLYPH.dot);
	}

	#badge(room: Room): string {
		const { theme } = this.#options;
		const here = this.#options.view.here(room.id);
		if (here === undefined) return "";
		const others = here.live().filter((peer) => peer.session !== here.session);
		if (others.some((peer) => stateOf(peer) === "waiting"))
			return theme.fg("warning", MARKS.waiting);
		const unread = here.summary().unread;
		return unread > 0 ? theme.fg("accent", String(unread)) : "";
	}

	#mainLines(open: Room | undefined, width: number, height: number): string[] {
		if (this.#picker !== undefined) {
			this.#picker.focused = this.focused;
			return this.#picker.lines(width, height);
		}
		const room = this.#roomView(open);
		if (room === undefined) return [];
		return room.lines(width, height, this.focused);
	}

	#status(open: Room | undefined): string {
		const { theme } = this.#options;
		const closing =
			this.#closing === undefined
				? undefined
				: this.#options.view.rooms().find((room) => room.id === this.#closing);
		if (closing !== undefined) return theme.fg("warning", `close ${closing.name}?`);
		const here = open === undefined ? undefined : this.#options.view.here(open.id);
		if (open === undefined || here === undefined) return "";
		const live = here.live();
		const parts: string[] = [];
		if (open.id !== undefined && open.folders.length > 0)
			parts.push(plural(open.folders.length, "folder"));
		parts.push(`${live.length} open`);
		const waiting = live.filter((peer) => stateOf(peer) === "waiting").length;
		const text = theme.fg("dim", parts.join(", "));
		return waiting === 0
			? text
			: `${theme.fg("warning", `${MARKS.waiting} ${waiting} waits`)}   ${text}`;
	}

	/** The keys that matter now, the most used first; the room's own keys sit in its column. */
	#keys(open: Room | undefined): KeyHint[] {
		if (this.#picker !== undefined) return this.#picker.keys();
		if (this.#closing !== undefined)
			return [
				["y", "close it"],
				["esc", "keep it"],
			];
		const room = this.#roomView(open);
		if (room?.picking() === true) return room.keys();
		const agent = this.#pointedEntry();
		if (agent !== undefined) {
			const keys: KeyHint[] = [];
			if (agent.kind === "agent")
				keys.push(
					["enter", this.#options.show === undefined ? "write to" : "view"],
					["alt+o", room?.only() === agent.peer.session ? "everyone" : "only"],
				);
			if (open?.id !== undefined) keys.push(["alt+r", "remove"]);
			keys.push([`alt+${GLYPH.up}${GLYPH.down}`, "agents"], ["esc", "back"]);
			return keys;
		}
		const keys: KeyHint[] = [["enter", "send"]];
		if (open !== undefined) keys.push(["alt+m", modeKey(open)]);
		if (this.#options.view.rooms().length > 1) keys.push(["tab", "next room"]);
		keys.push([`alt+${GLYPH.up}${GLYPH.down}`, "agents"], ["esc", "close"]);
		return keys;
	}

	/** The agents and folders alt+↑↓ walks, this session left out: nothing to do on yourself. */
	#pointable(): Entry[] {
		const open = this.#openRoom();
		if (open === undefined) return [];
		const here = this.#options.view.here(open.id);
		if (here === undefined) return [];
		const entries: Entry[] = inOrder(here.live(), here.session)
			.filter((peer) => peer.session !== here.session)
			.map((peer) => ({ kind: "agent", room: open, peer }));
		for (const folder of open.id === undefined ? [] : open.folders)
			entries.push({ kind: "folder", room: open, ...folder });
		return entries;
	}

	#pointedEntry(): Entry | undefined {
		if (this.#pointed === undefined) return undefined;
		const entry = this.#pointable().find((one) => keyOfEntry(one) === this.#pointed);
		if (entry === undefined) this.#pointed = undefined;
		return entry;
	}

	#movePointer(step: number): boolean {
		const entries = this.#pointable();
		if (entries.length === 0) return true;
		const at = entries.findIndex((entry) => keyOfEntry(entry) === this.#pointed);
		const next = at < 0 ? (step > 0 ? 0 : entries.length - 1) : at + step;
		this.#point(next < 0 || next >= entries.length ? undefined : entries[next]);
		return true;
	}

	#point(entry: Entry | undefined): void {
		this.#pointed = entry === undefined ? undefined : keyOfEntry(entry);
		this.#options.requestRender();
	}

	#switch(step: number): void {
		const rooms = this.#options.view.rooms();
		if (rooms.length < 2) return;
		const open = this.#openRoom();
		const at = rooms.findIndex((room) => open !== undefined && keyOf(room) === keyOf(open));
		const next = rooms[(at + step + rooms.length) % rooms.length];
		if (next === undefined) return;
		this.#open = keyOf(next);
		this.#pointed = undefined;
		this.#options.requestRender();
	}

	#openRoom(): Room | undefined {
		const rooms = this.#options.view.rooms();
		const room = rooms.find((one) => keyOf(one) === this.#open) ?? rooms[0];
		if (room !== undefined && keyOf(room) !== this.#open) {
			this.#open = keyOf(room);
			this.#pointed = undefined;
		}
		this.#forgetLeft(rooms);
		return room;
	}

	#roomView(room: Room | undefined): RoomView | undefined {
		if (room === undefined) return undefined;
		const key = keyOf(room);
		const kept = this.#rooms.get(key);
		if (kept !== undefined) return kept;
		const { view, theme } = this.#options;
		const here: Here | undefined = view.here(room.id);
		if (here === undefined) return undefined;
		const made = new RoomView({
			theme,
			here,
			room: room.id === undefined ? undefined : room.name,
			origin: room.origin,
			requestRender: this.#options.requestRender,
			now: this.#options.now,
			clock: this.#options.clock,
			send: (text) => view.send(room.id, text),
		});
		this.#rooms.set(key, made);
		return made;
	}

	#enter(entry: Entry): void {
		if (entry.kind !== "agent") return;
		if (this.#options.show?.(entry.peer.session) === true) return;
		this.#writeTo(entry);
	}

	#writeTo(entry: Entry & { kind: "agent" }): void {
		const handle = this.#options.view
			.here(entry.room.id)
			?.names()
			.bySession.get(entry.peer.session)?.handle;
		if (handle !== undefined) this.#roomView(entry.room)?.mention(handle);
		this.#point(undefined);
	}

	#narrow(entry: Entry & { kind: "agent" }): void {
		const room = this.#roomView(entry.room);
		if (room === undefined) return;
		room.narrow(room.only() === entry.peer.session ? undefined : entry.peer.session);
	}

	#confirm(data: string): void {
		const room = this.#closing;
		this.#closing = undefined;
		if (room !== undefined && data === "y") return this.#act(() => this.#options.view.close(room));
		this.#options.requestRender();
	}

	#pick(room: Room | undefined): void {
		const { theme, view } = this.#options;
		const me = view.live().find((live) => live.session === this.#me());
		this.#picker = new Picker({
			theme,
			view,
			room,
			start: room === undefined && me !== undefined ? [sessionRow(me)] : [],
			requestRender: this.#options.requestRender,
			done: (made) => {
				this.#picker = undefined;
				if (made !== undefined) {
					this.#open = made;
					this.#pointed = undefined;
				}
				this.#options.requestRender();
			},
		});
		this.#options.requestRender();
	}

	#act(change: () => void): void {
		change();
		this.#options.requestRender();
	}

	#forgetLeft(rooms: readonly Room[]): void {
		const kept = new Set(rooms.map(keyOf));
		for (const key of this.#rooms.keys()) if (!kept.has(key)) this.#rooms.delete(key);
	}

	#me(): string {
		return this.#options.view.here(undefined)?.session ?? "";
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}
}

/** What each mode means for this session, said where the mode is shown. */
const MODES: Record<RoomMode, { verb: string; means: string }> = {
	in: { verb: "takes part", means: "Everything said here reaches it." },
	listening: { verb: "listens", means: "Only what names it reaches it." },
	out: { verb: "stepped out", means: "Nothing said here reaches it." },
};

/** Every room walks the same three states; out keeps the row to come back. */
function nextMode(room: Room): RoomMode {
	if (room.mode === "in") return "listening";
	return room.mode === "listening" ? "out" : "in";
}

function modeKey(room: Room): string {
	const next = nextMode(room);
	if (next === "listening") return "listen";
	return next === "out" ? "step out" : "take part";
}

function keyOf(room: Room): string {
	return room.id ?? FOLDER;
}

function keyOfEntry(entry: Entry): string {
	switch (entry.kind) {
		case "room":
			return keyOf(entry.room);
		case "agent":
			return entry.peer.session;
		case "folder":
			return folderKey(entry.path);
	}
}

function folderKey(path: string): string {
	return `folder ${path}`;
}

function heading(theme: Theme, label: string, count?: number): string {
	const title = theme.bold(theme.fg("muted", label));
	return count === undefined ? title : `${title} ${theme.fg("dim", String(count))}`;
}

/** Exactly `height` lines, so what comes under them stays at the bottom. */
function fitted(lines: readonly string[], height: number): string[] {
	return [
		...lines.slice(0, height),
		...Array.from({ length: Math.max(0, height - lines.length) }, () => ""),
	];
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function addressOf(
	open: readonly LiveSession[],
	session: string,
): SourceAddress | undefined {
	const entry = open.find((one) => one.session === session);
	if (entry === undefined) return undefined;
	const { host: machine, file } = entry;
	return { session, machine, ...(file === undefined ? {} : { file }) };
}

export async function openPanel(
	ctx: ExtensionContext,
	view: RoomsView,
	show?: (session: string) => boolean,
): Promise<void> {
	if (ctx.mode !== "tui") return;
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			hideImagesUnderOverlays(tui);
			let quiet = 0;
			const ticks = setInterval(() => {
				quiet += FRAME_MS;
				if (!panel.moving() && quiet < 1_000) return;
				quiet = 0;
				tui.requestRender();
			}, FRAME_MS);
			const stop = view.onChange(() => tui.requestRender());
			const panel: PeersPanel = new PeersPanel({
				theme,
				view,
				rows: () => tui.terminal.rows,
				requestRender: () => tui.requestRender(),
				...(show === undefined ? {} : { show }),
				close: () => {
					clearInterval(ticks);
					stop();
					done();
				},
			});
			return panel;
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
		},
	);
}
