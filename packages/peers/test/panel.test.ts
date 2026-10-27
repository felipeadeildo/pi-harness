import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Member } from "@adeildo/pi-kit";
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

const DOWN = "\x1b[B";
const ENTER = "\r";
const TAB = "\t";
const BACK_TAB = "\x1b[Z";
const ESC = "\x1b";
const ALT_DOWN = "\x1b[1;3B";
const ALT_UP = "\x1b[1;3A";
const alt = (key: string): string => `\x1b${key}`;

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
	readonly sent: { room: string | undefined; text: string }[] = [];

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
	send(room: string | undefined, text: string): void {
		this.sent.push({ room, text });
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
	setMode(room: string | undefined, mode: "in" | "listening"): void {
		this.calls.push(`mode ${room ?? "here"} ${mode}`);
	}
	onChange(): () => void {
		return () => {};
	}
	onMembership(): () => void {
		return () => {};
	}
}

/** The same room, standing the way the test wants it. */
function withMode(room: Room | undefined, mode: Room["mode"]): Room | undefined {
	return room === undefined ? undefined : { ...room, mode };
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
	return stripTerminalSequences(panel.render(110).join("\n"));
}

/** The column the line between the two sides sits at, on the first row under the tabs. */
function columnAt(drawn: string): number {
	const row = drawn.split("\n")[3] ?? "";
	return row.indexOf("\u2502", 1);
}

describe("the panel's layout", () => {
	test("it opens on the folder's room, with a tab for every room along the top", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const drawn = press(panelOf(rooms));
		const tabs = drawn.split("\n")[1] ?? "";
		expect(tabs).toContain("pi-harness");
		expect(tabs).toContain("backend+frontend");
		expect(drawn).toContain("message everyone, @ for one agent");
		expect(drawn).toContain("tab next room");
	});

	test("tab and shift+tab walk the rooms, and the column at the right keeps its place", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		const folder = press(panel);
		const other = press(panel, TAB);
		expect(other).toContain("message everyone in backend+frontend");
		expect(columnAt(other)).toBe(columnAt(folder));
		expect(press(panel, BACK_TAB)).toContain("message everyone, @ for one agent");
		expect(press(panel, BACK_TAB)).toContain("message everyone in backend+frontend");
	});

	test("each room keeps its unsent line", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		press(panel, ..."half a thought");
		expect(press(panel, TAB)).not.toContain("half a thought");
		expect(press(panel, TAB)).toContain("half a thought");
	});

	test("typing writes in the open room at once, with nothing to focus first", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		press(panel, ..."hi", ENTER, TAB, ..."the contract changed", ENTER);
		expect(rooms.sent).toEqual([
			{ room: undefined, text: "hi" },
			{ room: "r1", text: "the contract changed" },
		]);
	});

	test("a room this session left falls back to the folder's room", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		press(panel, TAB);
		rooms.shown.pop();
		expect(press(panel)).toContain("message everyone, @ for one agent");
	});

	test("too narrow for the column, it keeps the conversation and the line you write in", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const narrow = stripTerminalSequences(panelOf(rooms).render(60).join("\n"));
		expect(narrow).toContain("message everyone");
		expect(narrow).not.toContain("Agents");
	});
});

describe("an agent's line", () => {
	/** A shared room with the agent `api` in it, pointed at with alt+↓. */
	function onApi(show?: (session: string) => boolean): { rooms: Rooms; panel: PeersPanel } {
		const rooms = new Rooms(session("me", "/repo"));
		const here = shared(rooms);
		const api = session("api", "/home/x/backend");
		api.log("session.named", { handle: "api" });
		here.sync();
		const panel = panelOf(rooms, show);
		press(panel, TAB, ALT_DOWN);
		return { rooms, panel };
	}

	test("enter shows the pointed agent's session, and the panel stays as it was under it", () => {
		const shown: string[] = [];
		const { panel } = onApi((id) => shown.push(id) > 0);
		const before = press(panel);
		expect(before).toMatch(/❯ \S+ api/);
		expect(before).toContain("enter view");
		const after = press(panel, ENTER);
		expect(shown).toHaveLength(1);
		expect(shown[0]).toEndWith("api");
		expect(after).toBe(before);
	});

	test("with words written, enter sends them instead", () => {
		const shown: string[] = [];
		const { rooms, panel } = onApi((id) => shown.push(id) > 0);
		press(panel, ..."ping", ENTER);
		expect(shown).toEqual([]);
		expect(rooms.sent).toEqual([{ room: "r1", text: "ping" }]);
	});

	test("enter writes to the agent when nothing can show its session", () => {
		const unshown = onApi(() => false);
		expect(press(unshown.panel, ENTER)).toContain("@api");
		const without = onApi();
		expect(press(without.panel)).toContain("enter write to");
		expect(press(without.panel, ENTER)).toContain("@api");
	});

	test("esc lets go of the agent first, and closes the panel after", () => {
		const { rooms, panel } = onApi();
		expect(press(panel, ESC)).toContain("enter send");
		expect(rooms.calls).toEqual([]);
		press(panel, ESC);
		expect(rooms.calls).toEqual(["closed panel"]);
	});

	test("this session is never pointed at: there is nothing to do on yourself", () => {
		const { panel } = onApi();
		// api, then the room's two folders, then nothing.
		const drawn = press(panel, ALT_DOWN, ALT_DOWN, ALT_DOWN);
		expect(drawn).not.toMatch(/❯ \S+ docs/);
		expect(drawn).toContain("enter send");
		expect(press(panel, ALT_UP)).toMatch(/❯ frontend\//);
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

describe("changing the rooms", () => {
	test("a shared room says how it came to be, and its keys sit by it in the column", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const drawn = press(panelOf(rooms), TAB);
		expect(drawn).toContain("client asked");
		expect(drawn).toContain("2 folders");
		expect(drawn).toContain("alt+l leave");
		expect(drawn).toContain("alt+x close it");
	});

	test("alt+m walks a room through taking part, listening and out, and the key says the next step", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const drawn = press(panelOf(rooms), alt("m"));
		expect(rooms.calls).toEqual(["mode here listening"]);
		expect(drawn).toContain("alt+m listen");
		rooms.shown[0] = withMode(rooms.shown[0], "listening") as Room;
		expect(press(panelOf(rooms))).toContain("alt+m step out");
		press(panelOf(rooms), TAB, alt("m"));
		expect(rooms.calls.at(-1)).toBe("mode r1 listening");
		rooms.shown[1] = withMode(rooms.shown[1], "out") as Room;
		const back = press(panelOf(rooms), TAB, alt("m"));
		expect(rooms.calls.at(-1)).toBe("mode r1 in");
		expect(back).toContain("alt+m take part");
	});

	test("the mark before a room's name never moves the name in its tab", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const tab = (drawn: string): string => drawn.split("\n")[1] ?? "";
		expect(tab(press(panelOf(rooms)))).toContain("● pi-harness");
		rooms.shown[0] = withMode(rooms.shown[0], "listening") as Room;
		const listening = tab(press(panelOf(rooms)));
		expect(listening).toContain("◐ pi-harness");
		rooms.shown[0] = withMode(rooms.shown[0], "in") as Room;
		const at = (line: string): number =>
			visibleWidth(line.slice(0, Math.max(0, line.indexOf("backend+frontend"))));
		expect(at(listening)).toBe(at(tab(press(panelOf(rooms)))));
	});

	test("the folder's room cannot be left or closed", () => {
		const rooms = new Rooms(session("me", "/repo"));
		const drawn = press(panelOf(rooms), alt("l"), alt("x"));
		expect(rooms.calls).toEqual([]);
		expect(drawn).not.toContain("alt+l leave");
		expect(drawn).not.toContain("close pi-harness?");
		expect(drawn).toContain("alt+c new room");
	});

	test("closing asks first, and only y closes", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		expect(press(panel, TAB, alt("x"))).toContain("close backend+frontend?");
		press(panel, ESC);
		expect(rooms.calls).toEqual([]);
		press(panel, alt("x"), "y");
		expect(rooms.calls).toEqual(["close r1"]);
	});

	test("alt+r takes the pointed agent out of a shared room", () => {
		const rooms = new Rooms(session("me", "/repo"));
		const here = shared(rooms);
		session("api", "/home/x/backend").log("session.named", { handle: "api" });
		here.sync();
		press(panelOf(rooms), TAB, ALT_DOWN, alt("r"));
		expect(rooms.calls).toEqual(["remove r1 session:api"]);
	});

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
		const picker = press(panel, alt("c"));
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
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		const drawn = press(panel, TAB, alt("a"), ..."/srv/lab");
		expect(drawn).toContain("Nothing open matches");
		press(panel, ENTER);
		expect(rooms.calls).toEqual([]);
	});

	test("alt+r on a pointed folder takes the folder out of the room", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		const drawn = press(panel, TAB, ALT_DOWN, ALT_DOWN);
		expect(drawn).toMatch(/❯ frontend\/ +1 open/);
		expect(drawn).toContain("alt+r remove");
		press(panel, alt("r"));
		expect(rooms.calls).toEqual(["remove r1 folder:/home/x/frontend"]);
	});

	test("esc in the picker goes back to the room, and Alt+G closes the panel from anywhere", () => {
		const rooms = new Rooms(session("me", "/repo"));
		const panel = panelOf(rooms);
		expect(press(panel, alt("c"), ESC)).toContain("message everyone");
		press(panel, alt("c"), alt("g"));
		expect(rooms.calls).toEqual(["closed panel"]);
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
