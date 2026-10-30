import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Member, RoomMode } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import { Here, type Hooks } from "../src/here.ts";
import type { LiveSession, Room, RoomsView } from "../src/model.ts";
import { membershipNotice } from "../src/ui/message.ts";
import { addressOf, PeersPanel } from "../src/ui/panel.ts";

let root: string;
const opened: Here[] = [];
let clock = 1_000_000;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-panel-"));
	clock = 1_000_000;
	process.env.PI_HARNESS_EVENTS = root;
});

afterEach(() => {
	for (const here of opened) here.close();
	opened.length = 0;
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
});

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	dim: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";
const ALT_G = "\x1bg";

function session(id: string, cwd: string): Here {
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		sendMessage: () => {},
		sendUserMessage: () => {},
		idle: () => true,
		fit: async () => ({ fit: 0.5, reason: "" }),
		changed: () => {},
		show: () => {},
		now: () => clock,
		alive: () => true,
		defer: (run) => void setTimeout(run, 0),
	};
	const here = new Here(hooks);
	opened.push(here);
	here.open({ getCwd: () => cwd, getSessionId: () => id }, undefined);
	return here;
}

/** The rooms as a fake: what the panel asks is recorded, and the rooms are whatever the test says. */
class Rooms implements RoomsView {
	shown: Room[];
	readonly open: LiveSession[] = [];
	readonly heres = new Map<string, Here>();
	readonly calls: string[] = [];

	constructor(folder: Here) {
		this.heres.set("", folder);
		this.shown = [
			{
				id: undefined,
				mode: "in",
				name: "pi-harness",
				folders: [{ path: "/repo", open: 1 }],
				sessions: [],
			},
		];
	}

	rooms(): Room[] {
		return this.shown;
	}
	here(room: string | undefined): Here | undefined {
		return this.heres.get(room ?? "");
	}
	live(): LiveSession[] {
		return this.open;
	}
	summary(): { others: []; unread: number } {
		return { others: [], unread: 0 };
	}
	othersTyping(): [] {
		return [];
	}
	send(): void {
		this.calls.push("sent");
	}
	create(name: string, members: readonly Member[]): string {
		this.calls.push(`create ${name} ${members.map(memberText).join(" ")}`);
		return "r-new";
	}
	add(room: string, members: readonly Member[]): void {
		this.calls.push(`add ${room} ${members.map(memberText).join(" ")}`);
	}
	remove(room: string, member: Member): void {
		this.calls.push(`remove ${room} ${memberText(member)}`);
	}
	leave(room: string): void {
		this.calls.push(`leave ${room}`);
	}
	close(room: string): void {
		this.calls.push(`close ${room}`);
	}
	release(room: string | undefined, session: string): void {
		this.calls.push(`release ${room ?? "here"} ${session}`);
	}
	readonly modes = new Map<string, RoomMode>();
	modeOf(room: string | undefined, member: { session: string; cwd: string }): RoomMode | undefined {
		const set = this.modes.get(`${room ?? "here"} ${member.session}`);
		if (set !== undefined) return set;
		if (room === undefined) return member.cwd === "/repo" ? "in" : undefined;
		return "out";
	}
	setMode(room: string | undefined, mode: RoomMode, member?: { session: string }): void {
		this.calls.push(`mode ${room ?? "here"} ${member?.session ?? "me"} ${mode}`);
	}
	onChange(): () => void {
		return () => {};
	}
	onMembership(): () => void {
		return () => {};
	}
}

function memberText(member: Member): string {
	return "folder" in member ? `folder:${member.folder}` : `session:${member.session}`;
}

function shared(rooms: Rooms, cwd = "/home/x/backend"): Here {
	const here = session("me", cwd);
	rooms.heres.set("r1", here);
	rooms.shown.push({
		id: "r1",
		mode: "in",
		name: "backend+frontend",
		folders: [
			{ path: "/home/x/backend", open: 2 },
			{ path: "/home/x/frontend", open: 1 },
		],
		sessions: [{ session: "s9", cwd: "/home/x/research", handle: "docs-help", state: "idle" }],
		origin: "client asked: the /v1/fleet contract. You said yes.",
	});
	return here;
}

function panelOf(rooms: Rooms, show?: (session: string) => boolean): PeersPanel {
	const panel = new PeersPanel({
		...(show === undefined ? {} : { show }),
		theme: plain,
		view: rooms,
		close: () => rooms.calls.push("closed panel"),
		requestRender: () => {},
		rows: () => 24,
		now: () => 1_000_000,
	});
	panel.focused = true;
	return panel;
}

function press(panel: PeersPanel, ...keys: string[]): string {
	for (const key of keys) panel.handleInput(key);
	return stripTerminalSequences(panel.render(140).join("\n"));
}

function named(id: string, cwd: string, handle: string): Here {
	const here = session(id, cwd);
	here.log("session.named", { handle });
	return here;
}

/** This folder with oauth and migration, and the shared room with api from backend. */
function busy(): { rooms: Rooms; me: Here; room: Here } {
	const me = session("me", "/repo");
	named("oauth", "/repo", "oauth");
	named("migration", "/repo", "migration");
	me.log("session.named", { handle: "docs" });
	const rooms = new Rooms(me);
	const room = shared(rooms);
	named("api", "/home/x/backend", "api");
	me.sync();
	room.sync();
	return { rooms, me, room };
}

function line(drawn: string, has: string): string {
	return drawn.split("\n").find((one) => one.includes(has)) ?? "";
}

/** An agent's line, not the top edge that may name it too. */
function agentLine(drawn: string, handle: string): string {
	return drawn.split("\n").find((one) => one.includes(` ${handle} `) && /[●◐○]/.test(one)) ?? "";
}

function sessionOf(rooms: Rooms, handle: string): string {
	const names = rooms.here(undefined)?.names().bySession.values() ?? [];
	return [...names].find((one) => one.handle === handle)?.session ?? "";
}

describe("the rooms", () => {
	test("each room says what it is for, its folders, then its agents with what they hear and do", () => {
		const { rooms } = busy();
		const drawn = press(panelOf(rooms));
		expect(drawn).toContain("pi-harness  this folder's agents");
		expect(drawn).toContain("backend+frontend  client asked: the /v1/fleet contract.");
		expect(line(drawn, "oauth")).toMatch(/oauth +● all +idle/);
		expect(line(drawn, "backend/")).toContain("brings in every new session opened there");
		expect(line(drawn, "api")).toMatch(/api +○ off/);
		expect(drawn.indexOf("pi-harness")).toBeLessThan(drawn.indexOf("backend+frontend"));
		expect(drawn).not.toContain("Conversations");
	});

	test("what an agent is on stands on its line, and what it waits on you for comes first", () => {
		const { rooms, me } = busy();
		const migration = named("migration", "/repo", "migration");
		const card = { id: "c1", title: "Move the users table", column: "doing" as const, at: 1 };
		migration.log("board.changed", { view: { open: [card], backlog: 0, done: [] } });
		me.sync();
		expect(agentLine(press(panelOf(rooms)), "migration")).toMatch(/● all +Move the users table/);
		const blocked = { ...card, id: "c2", title: "Push to main", at: 2 };
		migration.log("board.changed", {
			view: {
				open: [card, { ...blocked, blocked: { on: "operator" as const, why: "push" } }],
				backlog: 0,
				done: [],
			},
		});
		me.sync();
		expect(agentLine(press(panelOf(rooms)), "migration")).toContain("waits on you: Push to main");
	});

	test("an agent switched off in a shared room keeps its line, so space brings it back", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const drawn = press(panel, DOWN, DOWN, DOWN, DOWN);
		expect(drawn).toMatch(/❯ +\S+ api/);
		expect(drawn).toContain("space switch to all");
		press(panel, " ");
		expect(rooms.calls).toEqual(["mode r1 api in"]);
	});
});

describe("hearing", () => {
	test("an agent added by name and switched off keeps its line while the panel is open", () => {
		const { rooms } = busy();
		rooms.modes.set("r1 oauth", "listening");
		const panel = panelOf(rooms);
		expect(press(panel, DOWN, DOWN, DOWN, DOWN, DOWN)).toMatch(/❯ +\S+ oauth +◐ @name/);
		press(panel, " ");
		rooms.modes.set("r1 oauth", "out");
		expect(press(panel)).toMatch(/❯ +\S+ oauth +○ off/);
		expect(press(panelOf(rooms))).not.toMatch(/oauth +○ off/);
	});

	test("space walks the agent under the cursor through all, @name and off, and the key says the next", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		expect(press(panel)).toMatch(/❯ +\S+ docs you/);
		press(panel, UP, UP);
		expect(press(panel)).toContain("space switch to @name");
		press(panel, " ");
		rooms.modes.set("here migration", "listening");
		expect(line(press(panel), "migration")).toContain("◐ @name");
		expect(press(panel)).toContain("space switch to off");
		expect(rooms.calls).toEqual(["mode here migration listening"]);
	});
});

describe("messages an agent holds", () => {
	test("show under the agent with why, and r lets them through", () => {
		const { rooms, me } = busy();
		const api = named("api", "/home/x/backend", "api");
		const id = me.post([sessionOf(rooms, "oauth")], "check the callback", "agent");
		const oauth = named("oauth", "/repo", "oauth");
		oauth.log("message.received", { id, mode: "next-turn", held: "quiet" });
		me.sync();
		const panel = panelOf(rooms);
		const drawn = press(panel, UP);
		expect(drawn).toContain("holds 1 message: the agents kept answering each other without you");
		expect(drawn).toContain("r let them through");
		press(panel, "r");
		expect(rooms.calls).toEqual([`release here ${sessionOf(rooms, "oauth")}`]);
		expect(api.session).toBe("api");
	});

	test("once let through while it runs, the line says they go in when the run ends", () => {
		const { rooms, me } = busy();
		const id = me.post([sessionOf(rooms, "oauth")], "check the callback", "agent");
		const oauth = named("oauth", "/repo", "oauth");
		oauth.log("message.received", { id, mode: "next-turn", held: "full" });
		me.sync();
		expect(press(panelOf(rooms))).toContain("holds 1 message: its run already took 8");
		me.log("messages.released", { session: sessionOf(rooms, "oauth") });
		me.sync();
		expect(press(panelOf(rooms))).toContain("1 message goes in when its run ends");
	});

	test("a run that starts after the message takes it, whoever started the run", () => {
		const { rooms, me } = busy();
		const id = me.post([sessionOf(rooms, "oauth")], "check the callback", "agent");
		const oauth = named("oauth", "/repo", "oauth");
		oauth.log("message.received", { id, mode: "next-turn", held: "stopped" });
		me.sync();
		expect(press(panelOf(rooms))).toContain("holds 1 message");
		clock += 1_000;
		oauth.log("session.state", { state: "running" });
		me.sync();
		expect(press(panelOf(rooms))).not.toContain("holds");
	});

	test("a message that went in is held no more", () => {
		const { rooms, me } = busy();
		const id = me.post([sessionOf(rooms, "oauth")], "check the callback", "agent");
		const oauth = named("oauth", "/repo", "oauth");
		oauth.log("message.received", { id, mode: "next-turn", held: "quiet" });
		oauth.log("message.received", { id, mode: "woke" });
		me.sync();
		expect(press(panelOf(rooms))).not.toContain("holds");
	});
});

describe("the panel's keys", () => {
	test("letters write nothing anywhere: the panel only reads", () => {
		const { rooms } = busy();
		press(panelOf(rooms), ..."hello", ENTER);
		expect(rooms.calls).toEqual([]);
	});

	test("enter shows the agent's session when something can", () => {
		const shown: string[] = [];
		const { rooms } = busy();
		const panel = panelOf(rooms, (id) => shown.push(id) > 0);
		expect(press(panel)).toContain("enter view");
		press(panel, ENTER);
		expect(shown).toEqual(["me"]);
	});

	test("on a shared room's line, a adds and x closes after a yes; the folder's room has neither", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const home = press(panel, UP, UP, UP);
		expect(home).toMatch(/❯ pi-harness/);
		expect(home).not.toContain("x close room");
		press(panel, "x");
		const asking = press(panel, DOWN, DOWN, DOWN, DOWN, "x");
		expect(asking).toContain("close backend+frontend?");
		press(panel, "n");
		expect(rooms.calls).toEqual([]);
		press(panel, "x", "y");
		expect(rooms.calls).toEqual(["close r1"]);
	});

	test("on a folder's line, x takes the folder out of the room", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const drawn = press(panel, DOWN, DOWN);
		expect(drawn).toMatch(/❯ backend\//);
		expect(drawn).toContain("x take backend/ out");
		press(panel, "x");
		expect(rooms.calls).toEqual(["remove r1 folder:/home/x/backend"]);
	});

	test("alone, the panel says how to bring in another agent", () => {
		const rooms = new Rooms(session("me", "/repo"));
		expect(press(panelOf(rooms))).toContain("You are alone here. Open pi in another terminal");
		expect(press(panelOf(busy().rooms))).not.toContain("You are alone here");
	});

	test("the panel fills the screen however few rooms it has", () => {
		const { rooms } = busy();
		expect(panelOf(rooms).render(140)).toHaveLength(24);
	});

	test("narrow, every line still fits", () => {
		const { rooms } = busy();
		const narrow = stripTerminalSequences(panelOf(rooms).render(50).join("\n"));
		expect(narrow).toContain("backend+frontend");
		expect(narrow.split("\n").every((one) => visibleWidth(one) <= 50)).toBe(true);
	});

	test("esc closes, and Alt+G closes from the picker too", () => {
		const { rooms } = busy();
		press(panelOf(rooms), ESC);
		press(panelOf(rooms), "n", ALT_G);
		expect(rooms.calls).toEqual(["closed panel", "closed panel"]);
	});

	test("a session is read from the machine and file its presence entry names", () => {
		const entry: LiveSession = {
			session: "s1",
			pid: 2,
			host: "box",
			cwd: "/repo",
			file: "/sessions/s1.jsonl",
			state: "running",
			at: 0,
			startedAt: 0,
		};
		const { file: _file, ...noFile } = entry;
		expect(addressOf([entry], "s1")).toEqual({
			session: "s1",
			machine: "box",
			file: "/sessions/s1.jsonl",
		});
		expect(addressOf([noFile], "s1")).toEqual({ session: "s1", machine: "box" });
		expect(addressOf([entry], "gone")).toBeUndefined();
	});
});

describe("making and filling rooms", () => {
	test("a new room starts with this session, then takes a name made of the folders", () => {
		const me = session("me", "/repo");
		const rooms = new Rooms(me);
		rooms.open.push(
			{
				session: me.session ?? "me",
				pid: 1,
				host: "h",
				cwd: "/repo",
				handle: "me",
				state: "idle",
				at: 0,
				startedAt: 0,
			},
			{
				session: "h1",
				pid: 2,
				host: "h",
				cwd: "/home/x/backend",
				handle: "api",
				state: "running",
				at: 0,
				startedAt: 0,
			},
		);
		const panel = panelOf(rooms);
		const picker = press(panel, "n");
		expect(picker).toContain("New room");
		expect(picker).toContain("1 picked");
		const filtered = press(panel, ..."backend");
		expect(filtered).toContain("the folder, every session in it");
		const covered = press(panel, " ", DOWN);
		expect(covered).toContain("with the folder");
		const naming = press(panel, ENTER);
		expect(naming).toContain("backend+repo");
		press(panel, ENTER);
		expect(rooms.calls).toEqual(["create backend+repo session:me folder:/home/x/backend"]);
	});

	test("a folder with no open agent cannot join", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const drawn = press(panel, DOWN, "a", ..."/srv/lab");
		expect(drawn).toContain("Nothing open matches");
		press(panel, ENTER);
		expect(rooms.calls).toEqual([]);
	});

	test("esc in the picker goes back to the rooms", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		expect(press(panel, "n", ESC)).toContain("this folder's agents");
	});
});

describe("the notice when this session joins or leaves", () => {
	const room: Room = {
		id: "r1",
		mode: "in",
		name: "backend+frontend",
		folders: [{ path: "/home/x/backend", open: 2 }],
		sessions: [
			{ session: "me", cwd: "/home/x/frontend", handle: "client", state: "idle" },
			{ session: "s9", cwd: "/home/x/research", handle: "docs-help", state: "idle" },
		],
	};

	test("joining says who added it, why, and who else is there, without this session", () => {
		const joined = membershipNotice(
			{ kind: "joined", room, by: "api", why: "ask about /v1/fleet" },
			"me",
		);
		expect(joined).toBe(
			"You joined backend+frontend, added by api: ask about /v1/fleet. With backend, docs-help. Alt+G shows it.",
		);
	});

	test("leaving says why", () => {
		expect(membershipNotice({ kind: "left", room, reason: "closed" })).toBe(
			"backend+frontend was closed, so you left it.",
		);
		expect(membershipNotice({ kind: "left", room, reason: "removed" })).toBe(
			"You were taken out of backend+frontend.",
		);
	});
});
