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

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-panel-"));
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
const RIGHT = "\x1b[C";
const ENTER = "\r";
const TAB = "\t";
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
		now: () => 1_000_000,
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
		clock: () => "12:00",
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

/** The messages' side, right of the column line. */
function messagesIn(drawn: string): string {
	return drawn
		.split("\n")
		.map((one) => one.split("\u2502")[2] ?? "")
		.join("\n");
}

function line(drawn: string, has: string): string {
	return drawn.split("\n").find((one) => one.includes(has)) ?? "";
}

describe("who hears which room", () => {
	test("every folder, its agents under it, and a column for each room", () => {
		const { rooms } = busy();
		const drawn = press(panelOf(rooms));
		expect(line(drawn, "backend+frontend")).toContain("pi-harness");
		expect(line(drawn, "oauth")).toMatch(/oauth +● all +○ off/);
		expect(line(drawn, "docs you")).toMatch(/● all/);
		expect(line(drawn, "backend/")).toMatch(/backend\/ +● folder/);
		expect(drawn).not.toContain("message everyone");
	});

	test("space walks the agent under the cursor through all, @name and off, and the key says the next", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const first = press(panel);
		expect(first).toMatch(/❯ +\S+ migration/);
		expect(first).toContain("space set @name");
		press(panel, " ");
		rooms.modes.set("here migration", "listening");
		expect(line(press(panel), "◇ migration")).toContain("◐ @name");
		expect(press(panel)).toContain("space set off");
		press(panel, RIGHT, " ");
		expect(rooms.calls).toEqual(["mode here migration listening", "mode r1 migration in"]);
	});

	test("an agent of another folder has no place in this folder's room, so space there does nothing", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const drawn = press(panel, DOWN, DOWN, DOWN, DOWN);
		expect(drawn).toMatch(/❯ +\S+ api/);
		expect(drawn).not.toContain("space set");
		press(panel, " ");
		expect(rooms.calls).toEqual([]);
	});

	test("on a folder's line in a shared room, space brings the whole folder in or takes it out", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		const top = press(panel, UP, RIGHT);
		expect(top).toMatch(/❯ repo\//);
		expect(top).toContain("space bring the folder in");
		press(panel, " ");
		press(panel, DOWN, DOWN, DOWN, DOWN, " ");
		expect(rooms.calls).toEqual(["add r1 folder:/repo", "remove r1 folder:/home/x/backend"]);
	});

	test("the right side shows what the agent under the cursor said and was sent in that room", () => {
		const { rooms, me } = busy();
		const oauth = rooms.here(undefined)?.names().bySession;
		const sessionOf = (handle: string) =>
			[...(oauth?.values() ?? [])].find((one) => one.handle === handle)?.session ?? "";
		me.post([sessionOf("oauth")], "are you on src/auth.ts?", "agent");
		me.post([sessionOf("migration")], "ship the SQL", "agent");
		const panel = panelOf(rooms);
		const onMigration = messagesIn(press(panel));
		expect(onMigration).toContain("migration in pi-harness");
		expect(onMigration).toContain("ship the SQL");
		expect(onMigration).not.toContain("are you on src/auth.ts?");
		const onFolder = messagesIn(press(panel, UP));
		expect(onFolder).toContain("are you on src/auth.ts?");
		expect(onFolder).toContain("ship the SQL");
	});
});

describe("what the agent under the cursor is on", () => {
	test("its card sits under the title, and what it waits on you for comes first", () => {
		const { rooms, me } = busy();
		const migration = named("migration", "/repo", "migration");
		migration.log("board.changed", {
			view: {
				open: [{ id: "c1", title: "Move the users table", column: "doing", at: 1 }],
				backlog: 0,
				done: [],
			},
		});
		me.sync();
		const drawn = messagesIn(press(panelOf(rooms)));
		expect(drawn).toMatch(/migration in pi-harness +\n +Move the users table/);
		migration.log("board.changed", {
			view: {
				open: [
					{ id: "c1", title: "Move the users table", column: "doing", at: 1 },
					{
						id: "c2",
						title: "Push to main",
						column: "doing",
						at: 2,
						blocked: { on: "operator", why: "push" },
					},
				],
				backlog: 0,
				done: [],
			},
		});
		me.sync();
		expect(messagesIn(press(panelOf(rooms)))).toContain("waits on you: Push to main");
	});
});

describe("who talks with whom", () => {
	test("tab moves to the conversations, each with its room, what came of it and its last words", () => {
		const { rooms, me } = busy();
		const names = [...(rooms.here(undefined)?.names().bySession.values() ?? [])];
		const sessionOf = (handle: string) => names.find((one) => one.handle === handle)?.session ?? "";
		const oauth = named("oauth", "/repo", "oauth");
		oauth.post([sessionOf("migration")], "Are you touching src/auth.ts?", "agent");
		me.post("all", "deploy at six", "you");
		me.sync();
		const panel = panelOf(rooms);
		const drawn = press(panel, TAB);
		expect(drawn).toContain("Conversations");
		expect(line(drawn, "you → everyone")).toContain("pi-harness");
		expect(drawn).toContain("oauth → migration");
		expect(drawn).toMatch(/oauth: Are you touching.* on its way to migration/);
		expect(drawn).toMatch(/you: deploy at six +3 agents haven't read it/);
		expect(messagesIn(drawn)).toContain("oauth → migration in pi-harness");
		expect(messagesIn(drawn)).not.toContain("deploy at six");
		expect(drawn).toContain("tab who hears");
		const second = messagesIn(press(panel, DOWN));
		expect(second).toContain("you → everyone in pi-harness");
		expect(second).not.toContain("Are you touching");
	});

	test("with nothing said, the list says where to write from", () => {
		const { rooms } = busy();
		expect(press(panelOf(rooms), TAB)).toContain("Write from the chat with @name.");
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
		expect(shown).toEqual(["migration"]);
	});

	test("closing a shared room asks first, and only y closes; the folder's room has no x", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		expect(press(panel)).not.toContain("x close room");
		press(panel, "x");
		const asking = press(panel, RIGHT, "x");
		expect(asking).toContain("close backend+frontend?");
		press(panel, "n");
		expect(rooms.calls).toEqual([]);
		press(panel, "x", "y");
		expect(rooms.calls).toEqual(["close r1"]);
	});

	test("too narrow to stand side by side, the grid, the conversations and the messages stack", () => {
		const { rooms } = busy();
		const narrow = stripTerminalSequences(panelOf(rooms).render(70).join("\n"));
		expect(narrow).toContain("Conversations");
		expect(narrow).toContain("migration in pi-harness");
		expect(narrow.split("\n").every((one) => visibleWidth(one) <= 70)).toBe(true);
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
		const drawn = press(panel, RIGHT, "a", ..."/srv/lab");
		expect(drawn).toContain("Nothing open matches");
		press(panel, ENTER);
		expect(rooms.calls).toEqual([]);
	});

	test("esc in the picker goes back to the grid", () => {
		const { rooms } = busy();
		const panel = panelOf(rooms);
		expect(press(panel, "n", ESC)).toContain("Conversations");
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
