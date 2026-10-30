// The `Alt+G` panel: who hears which room, who talks with whom, and what they said. It only reads;
// messages go from the chat.
import { basename } from "node:path";

import {
	CUT,
	FRAME_X,
	FRAME_Y,
	formatClock,
	type FrameLine,
	frame,
	GLYPH,
	hideImagesUnderOverlays,
	type KeyHint,
	LINE,
	type RoomMode,
	pointer,
	rule,
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
} from "@earendil-works/pi-tui";

import { stateOf } from "../cards.ts";
import {
	bothWays,
	type Conversation,
	conversationKey,
	conversationsIn,
	lastAt,
	speakerOf,
	type Standing,
	standingOf,
	YOU,
} from "../conversations.ts";
import type { Peer } from "../folder.ts";
import type { LiveSession, Room, RoomsView } from "../model.ts";
import type { Named } from "../names.ts";
import { glance, markOf, MARKS } from "./agents.ts";
import { involves } from "./feed.ts";
import { FRAME_MS } from "./motion.ts";
import { FeedPane, type PaneFocus } from "./pane.ts";
import { GUTTER, Picker, sessionRow } from "./picker.ts";

const FOLDER = "";
/** Narrower than this, the parts stand one under the other. */
const BESIDE = 96;
const LEFT_MIN = 44;
const LEFT_SHARE = 0.48;
const COLUMN_MIN = 9;
const COLUMN_MAX = 20;
const NAME_MIN = 10;
const NAME_MAX = 18;

type Row = { kind: "folder"; path: string } | { kind: "agent"; peer: Peer; cwd: string };

type Cell =
	| { kind: "agent"; mode: RoomMode }
	| { kind: "folder"; member: boolean }
	| { kind: "none" };

type Part = "grid" | "talk";

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
	clock?: (at: number) => string;
}

export class PeersPanel implements Component, Focusable {
	focused = false;

	readonly #options: PanelOptions;
	readonly #pane: FeedPane;
	#part: Part = "grid";
	/** Until the cursor moves, the first agent, as agents come and go. */
	#row: string | undefined;
	#column = FOLDER;
	#talk: string | undefined;
	#closing: string | undefined;
	#picker: Picker | undefined;

	constructor(options: PanelOptions) {
		this.#options = options;
		this.#pane = new FeedPane(options);
	}

	invalidate(): void {
		this.#picker?.invalidate();
	}

	moving(): boolean {
		if (this.#peers().some((peer) => stateOf(peer) === "running")) return true;
		return this.#pane.moving(this.#focus());
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("g"))) return this.#options.close();
		if (this.#picker !== undefined) return this.#picker.handleInput(data);
		if (this.#closing !== undefined) return this.#confirm(data);
		if (matchesKey(data, Key.escape)) return this.#options.close();
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab")))
			return this.#go(() => (this.#part = this.#part === "grid" ? "talk" : "grid"));
		if (matchesKey(data, Key.pageUp)) return this.#pane.page(-1);
		if (matchesKey(data, Key.pageDown)) return this.#pane.page(1);
		if (matchesKey(data, Key.shift("up"))) return this.#pane.scroll(-1);
		if (matchesKey(data, Key.shift("down"))) return this.#pane.scroll(1);
		if (data === "n") return this.#pick(undefined);
		if (this.#part === "talk") return this.#talkKey(data);
		this.#gridKey(data);
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
		if (delta === 0) return undefined;
		this.#pane.scroll(delta);
		return { handled: true };
	}

	#gridKey(data: string): void {
		const rows = this.#rows();
		const rooms = this.#options.view.rooms();
		if (matchesKey(data, Key.up))
			return this.#go(() => (this.#row = step(rows, this.#rowAt(), -1)));
		if (matchesKey(data, Key.down))
			return this.#go(() => (this.#row = step(rows, this.#rowAt(), 1)));
		if (matchesKey(data, Key.left))
			return this.#go(() => (this.#column = stepRoom(rooms, this.#columnAt(), -1)));
		if (matchesKey(data, Key.right))
			return this.#go(() => (this.#column = stepRoom(rooms, this.#columnAt(), 1)));
		const row = this.#selectedRow();
		const room = this.#selectedRoom();
		if (row === undefined || room === undefined) return;
		if (data === " ") return this.#go(() => this.#toggle(row, room));
		if (matchesKey(data, Key.enter) && row.kind === "agent")
			return void this.#options.show?.(row.peer.session);
		if (room.id === undefined) return;
		if (data === "a") return this.#pick(room);
		if (data === "x") return this.#go(() => (this.#closing = room.id));
	}

	#talkKey(data: string): void {
		const talks = this.#conversations();
		const at = this.#talkAt(talks);
		const keys = talks.map((talk) => talk.key);
		if (matchesKey(data, Key.up)) return this.#go(() => (this.#talk = stepKey(keys, at, -1)));
		if (matchesKey(data, Key.down)) return this.#go(() => (this.#talk = stepKey(keys, at, 1)));
	}

	#toggle(row: Row, room: Room): void {
		const { view } = this.#options;
		const cell = this.#cell(row, room);
		if (cell.kind === "agent" && row.kind === "agent")
			view.setMode(room.id, nextMode(cell.mode), { session: row.peer.session, cwd: row.cwd });
		else if (cell.kind === "folder" && room.id !== undefined && row.kind === "folder") {
			if (cell.member) view.remove(room.id, { folder: row.path });
			else view.add(room.id, [{ folder: row.path }]);
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
		const beside = inner >= BESIDE;
		const left = beside ? Math.max(LEFT_MIN, Math.floor(inner * LEFT_SHARE)) : inner;
		const right = beside ? inner - left - 3 : inner;
		const body: FrameLine[] = beside
			? this.#besideLines(left, right, height)
			: this.#stackedLines(inner, height);
		return frame(theme, width, body, {
			title: "Rooms",
			status: this.#status(),
			keys: this.#keys(),
			split: beside ? left + 1 : undefined,
			border: "borderMuted",
		});
	}

	#besideLines(left: number, right: number, height: number): string[] {
		const { theme } = this.#options;
		const grid = this.#gridLines(left);
		const talk = this.#talkLines(left, Math.max(2, height - grid.length - 2));
		const side = [...grid, "", ...talk];
		const feed = this.#pane.lines(this.#focus(), right, height);
		const column = theme.fg("borderMuted", LINE.v);
		const lines: string[] = [];
		for (let line = 0; line < height; line++) {
			const text = truncateToWidth(side[line] ?? "", left, "");
			const gap = " ".repeat(Math.max(0, left - visibleWidth(text)));
			lines.push(`${text}${gap} ${column} ${feed[line] ?? ""}`);
		}
		return lines;
	}

	#stackedLines(width: number, height: number): string[] {
		const { theme } = this.#options;
		const grid = this.#gridLines(width);
		const talkRows = Math.max(2, Math.min(8, Math.floor(height / 3)));
		const talk = this.#talkLines(width, talkRows);
		const top = [...grid, "", ...talk].slice(0, Math.max(4, height - 6));
		const feed = this.#pane.lines(this.#focus(), width, height - top.length - 1);
		return [...top, rule(theme, width), ...feed].slice(0, height);
	}

	#gridLines(width: number): string[] {
		const { theme, view } = this.#options;
		const rows = this.#rows();
		const rooms = view.rooms();
		const names = this.#names();
		const nameWidth = clamp(
			Math.max(0, ...rows.map((row) => visibleWidth(this.#rowLabel(row, names)) + indentOf(row))) +
				3,
			NAME_MIN,
			NAME_MAX,
		);
		const cellWidth = clamp(
			Math.max(0, ...rooms.map((room) => visibleWidth(room.name))) + 2,
			COLUMN_MIN,
			COLUMN_MAX,
		);
		const fits = Math.max(1, Math.floor((width - nameWidth) / cellWidth));
		const at = Math.max(
			0,
			rooms.findIndex((room) => keyOf(room) === this.#columnAt()),
		);
		const first = Math.max(0, Math.min(at - fits + 1, rooms.length - fits));
		const shown = rooms.slice(first, first + fits);
		const active = this.#part === "grid";
		const header = shown
			.map((room) => {
				const label = truncateToWidth(room.name, cellWidth - 2, CUT);
				const chosen = keyOf(room) === this.#columnAt();
				const text = chosen ? theme.bold(theme.fg("accent", label)) : theme.fg("muted", label);
				return pad(text, cellWidth);
			})
			.join("");
		const more =
			first + fits < rooms.length ? theme.fg("dim", ` +${rooms.length - first - fits}`) : "";
		const lines = [`${" ".repeat(nameWidth)}${header}${more}`];
		for (const row of rows) {
			const chosen = rowKey(row) === this.#rowAt();
			const indent = " ".repeat(indentOf(row));
			const label = truncateToWidth(
				this.#rowLabel(row, names, chosen),
				nameWidth - 3 - indent.length,
				CUT,
			);
			const lead = pad(`${pointer(theme, chosen, active)}${indent}${label}`, nameWidth);
			const cells = shown
				.map((room) => {
					const here = chosen && keyOf(room) === this.#columnAt();
					return pad(this.#cellText(this.#cell(row, room), here), cellWidth);
				})
				.join("");
			lines.push(`${lead}${cells}`);
		}
		if (rows.length === 0) lines.push(theme.fg("dim", `${GUTTER}No agent is open.`));
		return lines;
	}

	#rowLabel(row: Row, names: ReadonlyMap<string, Named>, chosen = false): string {
		const { theme } = this.#options;
		if (row.kind === "folder") return theme.fg("muted", `${basename(row.path) || row.path}/`);
		const named = names.get(row.peer.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		const handle = named?.handle ?? row.peer.handle ?? "new";
		const mark = markOf(row.peer, color, theme, this.#now());
		const me = row.peer.session === this.#me() ? theme.fg("dim", " you") : "";
		return `${mark} ${theme.fg(color, chosen ? theme.bold(handle) : handle)}${me}`;
	}

	#cellText(cell: Cell, chosen: boolean): string {
		const { theme } = this.#options;
		const weight = (text: string): string => (chosen ? theme.bold(text) : text);
		switch (cell.kind) {
			case "none":
				return chosen ? theme.fg("dim", "  -") : "";
			case "folder":
				return cell.member
					? weight(theme.fg("muted", `${GLYPH.dot} folder`))
					: theme.fg("dim", chosen ? `${GLYPH.ring} add` : "");
			case "agent":
				switch (cell.mode) {
					case "in":
						return weight(`${theme.fg("accent", GLYPH.dot)} ${theme.fg("text", HEARING.in)}`);
					case "listening":
						return weight(
							`${theme.fg("muted", GLYPH.half)} ${theme.fg("muted", HEARING.listening)}`,
						);
					case "out":
						return weight(theme.fg("dim", `${GLYPH.ring} ${HEARING.out}`));
				}
		}
	}

	#talkLines(width: number, height: number): string[] {
		const { theme } = this.#options;
		const talks = this.#conversations();
		const title = `${GUTTER}${theme.bold(theme.fg("muted", "Conversations"))}`;
		if (talks.length === 0)
			return [
				title,
				theme.fg("dim", `${GUTTER}Nobody has written yet. Write from the chat with @name.`),
			];
		const at = this.#talkAt(talks);
		const active = this.#part === "talk";
		const lines: string[] = [];
		let chosenAt = 0;
		for (const talk of talks) {
			const chosen = talk.key === at;
			if (chosen) chosenAt = lines.length;
			const room = this.#roomName(talk.room);
			const when = this.#clock(lastAt(talk));
			const right = `${theme.fg("dim", room)}  ${theme.fg("dim", when)}`;
			lines.push(
				spread(`${pointer(theme, chosen, active)}${this.#talkLabel(talk, chosen)}`, right, width),
				this.#lastLine(talk, width),
			);
		}
		const room = Math.max(2, height - 1);
		const first = Math.max(0, Math.min(chosenAt - room + 2, lines.length - room));
		return [title, ...lines.slice(first, first + room)];
	}

	#talkLabel(talk: Conversation, chosen: boolean): string {
		const { theme } = this.#options;
		return labelOf(talk, {
			who: (party) => {
				const text = this.#handleOf(party);
				const color =
					party === YOU ? "accent" : ((this.#names().get(party)?.color ?? "muted") as ThemeColor);
				return theme.fg(color, chosen ? theme.bold(text) : text);
			},
			quiet: (text) => theme.fg("dim", text),
			group: (text) => theme.fg("muted", text),
		});
	}

	/** Its last words, and what came of them at the right end. */
	#lastLine(talk: Conversation, width: number): string {
		const { theme } = this.#options;
		const last = talk.messages.at(-1);
		if (last === undefined) return "";
		const here = this.#options.view.here(talk.room);
		const standing = standingOf(last, here?.live() ?? [], this.#now());
		const right = theme.fg(
			"dim",
			standingWords(standing, (session) => this.#handleOf(session)),
		);
		const said = `    ${this.#handleOf(speakerOf(last))}: ${firstLine(last.text)}`;
		const room = Math.max(8, width - visibleWidth(right) - 2);
		return spread(theme.fg("muted", truncateToWidth(said, room, CUT)), right, width);
	}

	#focus(): PaneFocus | undefined {
		const { view } = this.#options;
		if (this.#part === "talk") {
			const talks = this.#conversations();
			const at = this.#talkAt(talks);
			const talk = talks.find((one) => one.key === at);
			const here = talk === undefined ? undefined : view.here(talk.room);
			if (talk !== undefined && here !== undefined)
				return {
					key: talk.key,
					here,
					title: `${labelOf(talk, { who: (party) => this.#handleOf(party) })} in ${this.#roomName(talk.room)}`,
					shows: {
						item: (item) =>
							item.kind === "message" && conversationKey(talk.room, item.message) === talk.key,
						typing: (typing) => talk.parties.includes(typing.session),
						empty: "Nothing said yet.",
					},
				};
		}
		const room = this.#selectedRoom();
		if (room === undefined) return undefined;
		const here = view.here(room.id);
		if (here === undefined) return undefined;
		const row = this.#selectedRow();
		const origin = room.origin === undefined ? {} : { origin: room.origin };
		const cell = row === undefined ? undefined : this.#cell(row, room);
		if (row?.kind === "agent" && cell?.kind === "agent" && cell.mode !== "out") {
			const session = row.peer.session;
			const handle = this.#handleOf(session);
			return {
				key: `${keyOf(room)}/${session}`,
				here,
				title: `${handle} in ${room.name}`,
				note: (width) => glance(row.peer, this.#options.theme, width),
				shows: {
					item: (item) => item.kind === "message" && involves(item, session),
					typing: (typing) => typing.session === session,
					empty: `Nothing from or to ${handle} in ${room.name} yet.`,
				},
				...origin,
			};
		}
		return {
			key: keyOf(room),
			here,
			title: room.name,
			shows: {
				item: (item) => item.kind === "message",
				typing: () => true,
				empty: `Nothing said in ${room.name} yet.`,
			},
			...origin,
		};
	}

	#status(): string {
		const { theme } = this.#options;
		const closing =
			this.#closing === undefined
				? undefined
				: this.#options.view.rooms().find((room) => room.id === this.#closing);
		if (closing !== undefined) return theme.fg("warning", `close ${closing.name}?`);
		const peers = this.#peers();
		const waiting = peers.filter((peer) => stateOf(peer) === "waiting");
		const rooms = this.#options.view.rooms().length;
		const text = theme.fg("dim", `${peers.length} open, ${plural(rooms, "room")}`);
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
		const scroll: KeyHint = ["pgup pgdn", "scroll"];
		if (this.#part === "talk")
			return [
				[`${GLYPH.up}${GLYPH.down}`, "move"],
				["tab", "who hears"],
				scroll,
				["n", "new room"],
				["esc", "close"],
			];
		const keys: KeyHint[] = [[`${GLYPH.up}${GLYPH.down}${GLYPH.left}${GLYPH.right}`, "move"]];
		const row = this.#selectedRow();
		const room = this.#selectedRoom();
		const cell = row === undefined || room === undefined ? undefined : this.#cell(row, room);
		if (cell?.kind === "agent") keys.push(["space", `set ${HEARING[nextMode(cell.mode)]}`]);
		if (cell?.kind === "folder" && room?.id !== undefined)
			keys.push(["space", cell.member ? "take the folder out" : "bring the folder in"]);
		if (row?.kind === "agent" && this.#options.show !== undefined) keys.push(["enter", "view"]);
		keys.push(["tab", "conversations"]);
		if (room?.id !== undefined) keys.push(["a", "add"], ["x", "close room"]);
		keys.push(["n", "new room"], ["esc", "close"]);
		return keys;
	}

	#cell(row: Row, room: Room): Cell {
		if (row.kind === "folder") {
			if (room.id === undefined) return { kind: "none" };
			return { kind: "folder", member: room.folders.some((folder) => folder.path === row.path) };
		}
		const mode = this.#options.view.modeOf(room.id, { session: row.peer.session, cwd: row.cwd });
		return mode === undefined ? { kind: "none" } : { kind: "agent", mode };
	}

	/** Each folder, then its agents; this folder first, this session last in it. */
	#rows(): Row[] {
		const { view } = this.#options;
		const rooms = view.rooms();
		const home = rooms.find((room) => room.id === undefined)?.folders[0]?.path;
		const peers = this.#peers();
		const folders = new Set<string>();
		if (home !== undefined) folders.add(home);
		for (const peer of peers) folders.add(peer.cwd ?? "");
		for (const room of rooms) for (const folder of room.folders) folders.add(folder.path);
		folders.delete("");
		const ordered = [...folders].toSorted(
			(a, b) => Number(b === home) - Number(a === home) || basename(a).localeCompare(basename(b)),
		);
		const rows: Row[] = [];
		for (const path of ordered) {
			rows.push({ kind: "folder", path });
			const here = peers
				.filter((peer) => peer.cwd === path)
				.toSorted(
					(a, b) =>
						Number(a.session === this.#me()) - Number(b.session === this.#me()) ||
						this.#handleOf(a.session).localeCompare(this.#handleOf(b.session)),
				);
			for (const peer of here) rows.push({ kind: "agent", peer, cwd: path });
		}
		return rows;
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

	#names(): Map<string, Named> {
		const { view } = this.#options;
		const names = new Map<string, Named>();
		for (const room of view.rooms())
			for (const [session, named] of view.here(room.id)?.names().bySession ?? [])
				if (!names.has(session)) names.set(session, named);
		return names;
	}

	#conversations(): Conversation[] {
		const { view } = this.#options;
		return view
			.rooms()
			.flatMap((room) => conversationsIn(room.id, view.here(room.id)?.folder.room ?? []))
			.toSorted((a, b) => lastAt(b) - lastAt(a));
	}

	#selectedRow(): Row | undefined {
		const at = this.#rowAt();
		return this.#rows().find((row) => rowKey(row) === at);
	}

	#selectedRoom(): Room | undefined {
		const at = this.#columnAt();
		return this.#options.view.rooms().find((room) => keyOf(room) === at);
	}

	#rowAt(): string | undefined {
		const rows = this.#rows();
		if (rows.some((row) => rowKey(row) === this.#row)) return this.#row;
		const first = rows.find((row) => row.kind === "agent") ?? rows[0];
		return first === undefined ? undefined : rowKey(first);
	}

	#columnAt(): string {
		const rooms = this.#options.view.rooms();
		if (!rooms.some((room) => keyOf(room) === this.#column))
			this.#column = rooms[0] === undefined ? FOLDER : keyOf(rooms[0]);
		return this.#column;
	}

	#talkAt(talks: readonly Conversation[]): string | undefined {
		if (!talks.some((talk) => talk.key === this.#talk)) this.#talk = talks[0]?.key;
		return this.#talk;
	}

	#handleOf(party: string): string {
		if (party === YOU) return "you";
		for (const room of this.#options.view.rooms()) {
			const handle = this.#options.view.here(room.id)?.handleOf(party);
			if (handle !== undefined) return handle;
		}
		return "gone";
	}

	#roomName(room: string | undefined): string {
		return this.#options.view.rooms().find((one) => one.id === room)?.name ?? "";
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
				if (made !== undefined) {
					this.#column = made;
					this.#part = "grid";
				}
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

	#clock(at: number): string {
		return (this.#options.clock ?? formatClock)(at);
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

interface Paint {
	who: (party: string) => string;
	quiet?: (text: string) => string;
	group?: (text: string) => string;
}

function labelOf(talk: Conversation, paint: Paint): string {
	const quiet = paint.quiet ?? ((text: string) => text);
	const group = paint.group ?? quiet;
	const [first = YOU, ...rest] = talk.parties;
	if (talk.audience !== undefined)
		return `${paint.who(first)} ${quiet(GLYPH.right)} ${group(talk.audience === "all" ? "everyone" : "anyone")}`;
	const arrow = bothWays(talk) && rest.length === 1 ? GLYPH.both : GLYPH.right;
	return `${paint.who(first)} ${quiet(arrow)} ${rest.map(paint.who).join(quiet(", "))}`;
}

function standingWords(standing: Standing, handleOf: (session: string) => string): string {
	const names = (sessions: readonly string[]): string =>
		sessions.length <= 2 ? sessions.map(handleOf).join(" and ") : `${sessions.length} agents`;
	switch (standing.kind) {
		case "sending":
			return `on its way to ${names(standing.to)}`;
		case "unread":
			return `${names(standing.by)} ${standing.by.length === 1 ? "hasn't" : "haven't"} read it`;
		case "read":
			return standing.by.length === 0 ? "sent" : `${names(standing.by)} read it`;
		case "taken":
			return `${handleOf(standing.by)} took it`;
		case "bidding":
			return "agents are bidding";
		case "busy":
			return "everyone is busy";
	}
}

function firstLine(text: string): string {
	return text.trim().split("\n")[0] ?? "";
}

function keyOf(room: Room): string {
	return room.id ?? FOLDER;
}

function rowKey(row: Row): string {
	return row.kind === "folder" ? `folder ${row.path}` : row.peer.session;
}

function step(rows: readonly Row[], at: string | undefined, by: number): string | undefined {
	return stepKey(rows.map(rowKey), at, by);
}

function stepRoom(rooms: readonly Room[], at: string, by: number): string {
	return stepKey(rooms.map(keyOf), at, by) ?? at;
}

function stepKey(keys: readonly string[], at: string | undefined, by: number): string | undefined {
	if (keys.length === 0) return undefined;
	const index = at === undefined ? -1 : keys.indexOf(at);
	return keys[clamp(index + by, 0, keys.length - 1)];
}

function indentOf(row: Row): number {
	return row.kind === "agent" ? 2 : 0;
}

function pad(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
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
