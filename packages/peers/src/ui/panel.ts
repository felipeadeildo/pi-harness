// The `Alt+G` panel: each room, who is in it, how much each agent hears there and what it is doing.
import { basename } from "node:path";

import {
	CUT,
	FRAME_X,
	FRAME_Y,
	frame,
	GLYPH,
	type Held,
	hideImagesUnderOverlays,
	type KeyHint,
	type RoomMode,
	pointer,
	type SourceAddress,
} from "@adeildo/pi-kit";
import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { stateOf } from "../cards.ts";
import type { Peer } from "../folder.ts";
import type { LiveSession, Room, RoomsView } from "../model.ts";
import { STEERS_PER_RUN } from "../rules.ts";
import { glance, markOf, MARKS } from "./agents.ts";
import { FRAME_MS } from "./motion.ts";
import { GUTTER, Picker, sessionRow } from "./picker.ts";

const HOME = "";
const NAME_MIN = 10;
const NAME_MAX = 22;
const HEARING_WIDTH = 10;

type Row =
	| { kind: "room"; room: Room }
	| { kind: "folder"; room: Room; path: string }
	| { kind: "agent"; room: Room; peer: Peer; mode: RoomMode };

interface Holding {
	count: number;
	why: Held | undefined;
	/** The operator let them through, and they go in when its run ends. */
	released: boolean;
}

export interface PanelOptions {
	theme: Theme;
	view: RoomsView;
	close: () => void;
	requestRender: () => void;
	rows: () => number;
	/** False when nothing can show it. */
	show?: (session: string) => boolean;
	/** So the docs pictures do not depend on when they are drawn. */
	now?: () => number;
}

export class PeersPanel implements Component, Focusable {
	focused = false;

	readonly #options: PanelOptions;
	#row: string | undefined;
	#closing: string | undefined;
	#picker: Picker | undefined;
	/** An agent switched off here keeps its row while the panel is open, so it can be switched back. */
	readonly #kept = new Set<string>();

	constructor(options: PanelOptions) {
		this.#options = options;
	}

	invalidate(): void {
		this.#picker?.invalidate();
	}

	moving(): boolean {
		return this.#peers().some((peer) => stateOf(peer) === "running");
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("g"))) return this.#options.close();
		if (this.#picker !== undefined) return this.#picker.handleInput(data);
		if (this.#closing !== undefined) return this.#confirm(data);
		if (matchesKey(data, Key.escape)) return this.#options.close();
		const rows = this.#rows();
		if (matchesKey(data, Key.up))
			return this.#go(() => (this.#row = step(rows, this.#rowAt(), -1)));
		if (matchesKey(data, Key.down))
			return this.#go(() => (this.#row = step(rows, this.#rowAt(), 1)));
		if (data === "n") return this.#pick(undefined);
		const row = this.#selected();
		if (row === undefined) return;
		const { view } = this.#options;
		switch (row.kind) {
			case "agent": {
				const member = { session: row.peer.session, cwd: row.peer.cwd ?? "" };
				if (data === " ")
					return this.#go(() => {
						this.#kept.add(rowKey(row));
						view.setMode(row.room.id, nextMode(row.mode), member);
					});
				if (matchesKey(data, Key.enter)) return void this.#options.show?.(row.peer.session);
				if (data === "r" && this.#holding(row) !== undefined)
					return this.#go(() => view.release(row.room.id, row.peer.session));
				return;
			}
			case "folder":
				if (data === "x" && row.room.id !== undefined) {
					const id = row.room.id;
					return this.#go(() => view.remove(id, { folder: row.path }));
				}
				return;
			case "room":
				if (row.room.id === undefined) return;
				if (data === "a") return this.#pick(row.room);
				if (data === "x") return this.#go(() => (this.#closing = row.room.id));
		}
	}

	render(width: number): string[] {
		const { theme } = this.#options;
		const inner = Math.max(20, width - FRAME_X);
		const height = Math.max(8, this.#options.rows() - FRAME_Y);
		if (this.#picker !== undefined) {
			this.#picker.focused = this.focused;
			return frame(theme, width, this.#picker.lines(inner, height), {
				title: "Rooms",
				keys: this.#picker.keys(),
				border: "borderMuted",
			});
		}
		return frame(theme, width, this.#lines(inner, height), {
			title: "Rooms",
			status: this.#status(),
			keys: this.#keys(),
			border: "borderMuted",
		});
	}

	#lines(width: number, height: number): string[] {
		const { theme } = this.#options;
		const rows = this.#rows();
		const at = this.#rowAt();
		const nameWidth = this.#nameWidth(rows);
		const lines: string[] = [];
		let chosenAt = 0;
		for (const [index, row] of rows.entries()) {
			if (row.kind === "room" && index > 0) lines.push("");
			const chosen = rowKey(row) === at;
			if (chosen) chosenAt = lines.length;
			lines.push(this.#rowLine(row, chosen, width, nameWidth));
			const holding = row.kind === "agent" ? this.#holding(row) : undefined;
			if (holding !== undefined) lines.push(this.#holdingLine(holding, nameWidth, width));
			const next = rows[index + 1];
			if (row.kind !== "agent" && (next === undefined || next.kind === "room"))
				lines.push(theme.fg("dim", `${GUTTER}${GUTTER}No agent is open in it.`));
		}
		if (rows.length === 0) lines.push(theme.fg("dim", `${GUTTER}No room yet.`));
		if (this.#peers().length === 1)
			lines.push(
				"",
				theme.fg(
					"dim",
					`${GUTTER}You are alone here. Open pi in another terminal in this folder, or press n to bring in another folder.`,
				),
			);
		const first = Math.max(0, Math.min(chosenAt - height + 2, lines.length - height));
		const shown = lines.slice(first, first + height);
		return [...shown, ...Array.from({ length: height - shown.length }, () => "")];
	}

	#rowLine(row: Row, chosen: boolean, width: number, nameWidth: number): string {
		const { theme } = this.#options;
		const lead = pointer(theme, chosen);
		switch (row.kind) {
			case "room": {
				const name = theme.bold(theme.fg(chosen ? "accent" : "text", row.room.name));
				const about = row.room.id === undefined ? "this folder's agents" : (row.room.origin ?? "");
				const room = Math.max(0, width - visibleWidth(lead) - visibleWidth(row.room.name) - 2);
				return `${lead}${name}  ${theme.fg("dim", truncateToWidth(about, room, CUT))}`;
			}
			case "folder": {
				const folder = pad(theme.fg(chosen ? "accent" : "muted", folderName(row.path)), nameWidth);
				return `${GUTTER}${lead}${folder}${theme.fg("dim", "brings in every new session opened there")}`;
			}
			case "agent": {
				const label = pad(this.#agentLabel(row.peer, chosen), nameWidth);
				const hearing = pad(this.#hearing(row.mode, chosen), HEARING_WIDTH);
				const room = Math.max(8, width - 4 - nameWidth - HEARING_WIDTH);
				return `${GUTTER}${lead}${label}${hearing}${this.#doing(row.peer, room)}`;
			}
		}
	}

	#agentLabel(peer: Peer, chosen: boolean): string {
		const { theme } = this.#options;
		const color = this.#colorOf(peer.session);
		const handle = this.#handleOf(peer.session);
		const mark = markOf(peer, color, theme, this.#now());
		const me = peer.session === this.#me() ? theme.fg("dim", " you") : "";
		return `${mark} ${theme.fg(color, chosen ? theme.bold(handle) : handle)}${me}`;
	}

	#hearing(mode: RoomMode, chosen: boolean): string {
		const { theme } = this.#options;
		const weight = (text: string): string => (chosen ? theme.bold(text) : text);
		switch (mode) {
			case "in":
				return weight(`${theme.fg("accent", GLYPH.dot)} ${theme.fg("text", HEARING.in)}`);
			case "listening":
				return weight(`${theme.fg("muted", GLYPH.half)} ${theme.fg("muted", HEARING.listening)}`);
			case "out":
				return weight(theme.fg("dim", `${GLYPH.ring} ${HEARING.out}`));
		}
	}

	#doing(peer: Peer, width: number): string {
		const { theme } = this.#options;
		const card = glance(peer, theme, width);
		if (card !== undefined) return card;
		return stateOf(peer) === "running" ? theme.fg("muted", "working") : theme.fg("dim", "idle");
	}

	#holdingLine(holding: Holding, nameWidth: number, width: number): string {
		const { theme } = this.#options;
		const text = holding.released
			? `${count(holding.count)} ${holding.count === 1 ? "goes" : "go"} in when its run ends`
			: holdingWords(holding);
		const indent = `${GUTTER}${GUTTER}${" ".repeat(Math.min(4, nameWidth))}`;
		const room = Math.max(8, width - visibleWidth(indent));
		return `${indent}${theme.fg("warning", truncateToWidth(text, room, CUT))}`;
	}

	/** Messages the agent got for its next turn since its latest run started, which took any before. */
	#holding(row: Extract<Row, { kind: "agent" }>): Holding | undefined {
		const folder = this.#options.view.here(row.room.id)?.folder;
		if (folder === undefined) return undefined;
		const session = row.peer.session;
		let found = 0;
		let why: Held | undefined;
		let last = 0;
		const since = Math.max(row.peer.startedAt, row.peer.ranAt ?? 0);
		for (const message of folder.messages.values()) {
			const received = message.received.get(session);
			if (received?.mode !== "next-turn" || received.at < since) continue;
			found++;
			if (received.at >= last) {
				last = received.at;
				why = received.held;
			}
		}
		if (found === 0) return undefined;
		return { count: found, why, released: (folder.released.get(session) ?? 0) >= last };
	}

	#status(): string {
		const { theme, view } = this.#options;
		const closing =
			this.#closing === undefined
				? undefined
				: view.rooms().find((room) => room.id === this.#closing);
		if (closing !== undefined) return theme.fg("warning", `close ${closing.name}?`);
		const peers = this.#peers();
		const waiting = peers.filter((peer) => stateOf(peer) === "waiting");
		const text = theme.fg(
			"dim",
			`${plural(peers.length, "agent")}, ${plural(view.rooms().length, "room")}`,
		);
		if (waiting.length === 0) return text;
		const who = waiting.map((peer) => this.#handleOf(peer.session)).join(", ");
		return `${theme.fg("warning", `${MARKS.waiting} ${who} ${waiting.length === 1 ? "waits" : "wait"} on you`)}   ${text}`;
	}

	#keys(): KeyHint[] {
		if (this.#closing !== undefined)
			return [
				["y", "close it"],
				["esc", "keep it"],
			];
		const keys: KeyHint[] = [[`${GLYPH.up}${GLYPH.down}`, "move"]];
		const row = this.#selected();
		if (row?.kind === "agent") {
			keys.push(["space", `switch to ${HEARING[nextMode(row.mode)]}`]);
			if (this.#holding(row) !== undefined) keys.push(["r", "let them through"]);
			if (this.#options.show !== undefined) keys.push(["enter", "view"]);
		}
		if (row?.kind === "folder" && row.room.id !== undefined)
			keys.push(["x", `take ${folderName(row.path)} out`]);
		if (row?.kind === "room" && row.room.id !== undefined)
			keys.push(["a", "add"], ["x", "close room"]);
		keys.push(["n", "new room"], ["esc", "close"]);
		return keys;
	}

	/** Each room, its folders, then its agents; this folder's room first and this session last in it. */
	#rows(): Row[] {
		const { view } = this.#options;
		const peers = this.#peers().toSorted(
			(a, b) =>
				Number(a.session === this.#me()) - Number(b.session === this.#me()) ||
				this.#handleOf(a.session).localeCompare(this.#handleOf(b.session)),
		);
		const rows: Row[] = [];
		for (const room of view.rooms()) {
			rows.push({ kind: "room", room });
			if (room.id !== undefined)
				for (const folder of room.folders) rows.push({ kind: "folder", room, path: folder.path });
			for (const peer of peers) {
				const mode = view.modeOf(room.id, { session: peer.session, cwd: peer.cwd ?? "" });
				if (mode === undefined) continue;
				const row: Row = { kind: "agent", room, peer, mode };
				if (this.#belongs(row)) rows.push(row);
			}
		}
		return rows;
	}

	#belongs(row: Extract<Row, { kind: "agent" }>): boolean {
		if (row.room.id === undefined || row.mode !== "out") return true;
		if (this.#kept.has(rowKey(row))) return true;
		return row.room.folders.some((folder) => folder.path === row.peer.cwd);
	}

	#nameWidth(rows: readonly Row[]): number {
		const widest = Math.max(
			0,
			...rows.map((row) =>
				row.kind === "agent" ? visibleWidth(this.#agentLabel(row.peer, false)) : 0,
			),
		);
		const folders = Math.max(
			0,
			...rows.map((row) => (row.kind === "folder" ? folderName(row.path).length : 0)),
		);
		return clamp(Math.max(widest, folders) + 3, NAME_MIN, NAME_MAX);
	}

	/** Every open agent the rooms see, once. */
	#peers(): Peer[] {
		const { view } = this.#options;
		const found = new Map<string, Peer>();
		for (const room of view.rooms())
			for (const peer of view.here(room.id)?.live() ?? [])
				if (!found.has(peer.session)) found.set(peer.session, peer);
		return [...found.values()];
	}

	#selected(): Row | undefined {
		const at = this.#rowAt();
		return this.#rows().find((row) => rowKey(row) === at);
	}

	/** Until the cursor moves, this session in the folder's room. */
	#rowAt(): string | undefined {
		const rows = this.#rows();
		if (rows.some((row) => rowKey(row) === this.#row)) return this.#row;
		const first =
			rows.find((row) => row.kind === "agent" && row.peer.session === this.#me()) ??
			rows.find((row) => row.kind === "agent") ??
			rows[0];
		return first === undefined ? undefined : rowKey(first);
	}

	#handleOf(session: string): string {
		for (const room of this.#options.view.rooms()) {
			const handle = this.#options.view.here(room.id)?.handleOf(session);
			if (handle !== undefined) return handle;
		}
		return "new";
	}

	#colorOf(session: string): ThemeColor {
		for (const room of this.#options.view.rooms()) {
			const named = this.#options.view.here(room.id)?.names().bySession.get(session);
			if (named !== undefined) return named.color as ThemeColor;
		}
		return "muted";
	}

	#confirm(data: string): void {
		const room = this.#closing;
		this.#closing = undefined;
		if (room !== undefined && data === "y") return this.#go(() => this.#options.view.close(room));
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
				if (made !== undefined) this.#row = `room ${made}`;
				this.#options.requestRender();
			},
		});
		this.#options.requestRender();
	}

	#go(change: () => void): void {
		change();
		this.#options.requestRender();
	}

	#me(): string {
		return this.#options.view.here(undefined)?.session ?? "";
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}
}

const HEARING: Record<RoomMode, string> = { in: "all", listening: "@name", out: "off" };

function nextMode(mode: RoomMode): RoomMode {
	if (mode === "in") return "listening";
	return mode === "listening" ? "out" : "in";
}

function holdingWords({ count: found, why }: Holding): string {
	const held = `holds ${count(found)}`;
	switch (why) {
		case "asleep":
			return `${held} until you first write to it`;
		case "quiet":
			return `${held}: the agents kept answering each other without you`;
		case "full":
			return `${held}: its run already took ${STEERS_PER_RUN}`;
		case "stopped":
			return `${held}: you stopped its run`;
		case undefined:
			return `${held} for its next turn`;
	}
}

function folderName(path: string): string {
	return `${basename(path) || path}/`;
}

function count(found: number): string {
	return found === 1 ? "1 message" : `${found} messages`;
}

function rowKey(row: Row): string {
	const room = row.room.id ?? HOME;
	switch (row.kind) {
		case "room":
			return `room ${room}`;
		case "folder":
			return `folder ${room} ${row.path}`;
		case "agent":
			return `agent ${room} ${row.peer.session}`;
	}
}

function step(rows: readonly Row[], at: string | undefined, by: number): string | undefined {
	const keys = rows.map(rowKey);
	if (keys.length === 0) return undefined;
	const index = at === undefined ? -1 : keys.indexOf(at);
	return keys[clamp(index + by, 0, keys.length - 1)];
}

function pad(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

function plural(found: number, word: string): string {
	return `${found} ${word}${found === 1 ? "" : "s"}`;
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
			const ticks = setInterval(() => {
				if (panel.moving()) tui.requestRender();
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
