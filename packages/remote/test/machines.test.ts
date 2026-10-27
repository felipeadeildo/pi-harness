// Two machines of one owner on a tailnet, each with its daemon, on two loopback addresses. A client
// of one daemon lists the other's sessions, reads one, and talks to it, with no pairing between them.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { envelope, type Envelope } from "@adeildo/pi-remote-protocol";

import { Machines } from "../src/daemon/machines.ts";
import { Mirror } from "../src/daemon/mirror.ts";
import { Daemon } from "../src/daemon/server.ts";
import type { AskTailscale, Tailnet } from "../src/daemon/tailnet.ts";
import { bridgeOf } from "./daemon-harness.ts";
import { until } from "./fakes.ts";
import { logIn } from "./login.ts";

const OWNER = 6629714470969663;
const OTHER = 1234;

const DESK: Tailnet = { name: "desk.example.ts.net", ip: "127.0.0.2", user: OWNER };
const LAPTOP: Tailnet = { name: "laptop.example.ts.net", ip: "127.0.0.3", user: OWNER };
/** Another user's node, shared into the tailnet: never one of the owner's machines. */
const SHARED: Tailnet = { name: "theirs.example.ts.net", ip: "127.0.0.4", user: OTHER };

let dir = "";
const running: Daemon[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-remote-machines-"));
});

afterEach(() => {
	for (const daemon of running.splice(0)) daemon.stop();
	rmSync(dir, { recursive: true, force: true });
});

/** `tailscale` as the desk sees its tailnet, where every address belongs to the owner. */
const ask: AskTailscale = async (args) => {
	if (args[0] === "whois") return JSON.stringify({ UserProfile: { ID: OWNER } });
	const node = (one: Tailnet, online = true) => ({
		DNSName: `${one.name}.`,
		TailscaleIPs: [one.ip],
		UserID: one.user,
		Online: online,
	});
	return JSON.stringify({
		Self: node(DESK),
		Peer: {
			laptop: node(LAPTOP),
			shared: node(SHARED),
			off: node({ ...LAPTOP, ip: "127.0.0.5" }, false),
		},
	});
};

async function start(name: string, tailnet: Tailnet, machines?: Machines): Promise<Daemon> {
	const daemon = await Daemon.start({
		socket: join(dir, name, "daemon.sock"),
		version: "1.2.0",
		clientPort: 0,
		machine: name,
		tailnet,
		ask,
		events: join(dir, name, "events"),
		...(machines === undefined ? {} : { machines }),
	});
	if (daemon?.clientPort === undefined) throw new Error(`${name} did not start`);
	running.push(daemon);
	return daemon;
}

/** The desk and the laptop, the laptop with one session, and the desk's client logged in. */
async function twoMachines() {
	const laptop = await start("laptop", LAPTOP);
	const machines = new Machines({
		self: "desk",
		// Each daemon has its own port here; on a real tailnet both use the same one.
		originOf: (node) => `http://${node.ip}:${laptop.clientPort}`,
		ask,
	});
	const desk = await start("desk", DESK, machines);
	await machines.look();
	const bridge = await bridgeOf("s1", "e1", undefined, join(dir, "laptop", "daemon.sock"));
	bridge.state([]);
	await until(() => laptop.sessions.opening("s1") !== undefined);
	const port = desk.clientPort ?? 0;
	const cookie = await logIn(desk, port);
	const get = (path: string) =>
		fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie } }).then((answer) =>
			answer.json(),
		);
	return { laptop, desk, machines, bridge, port, cookie, get };
}

test("a daemon finds the owner's machines that run one, and nothing else", async () => {
	const { machines } = await twoMachines();
	expect(machines.list().map((one) => one.name)).toEqual(["laptop"]);
});

test("the list holds the other machine's sessions, and a daemon asking for its own does not", async () => {
	const { get } = await twoMachines();
	const everywhere = (await get("/sessions")) as { machine: string; session: string }[];
	expect(everywhere.map((one) => `${one.session}@${one.machine}`)).toEqual(["s1@laptop"]);
	expect(await get("/sessions?here")).toEqual([]);
});

test("a session of the other machine opens through this daemon", async () => {
	const { get } = await twoMachines();
	const opening = (await get("/sessions/laptop/s1/opening")) as Envelope;
	expect(opening.type).toBe("state");
	expect(opening.session).toBe("s1");
});

test("a socket for the other machine's session reaches its bridge, and its events come back", async () => {
	const { port, cookie, bridge } = await twoMachines();
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?machine=laptop`, {
		headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
	});
	const heard: Envelope[] = [];
	ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)));
	await new Promise((resolve) => (ws.onopen = resolve));
	ws.send(JSON.stringify(envelope("hello", "client", {}, { session: "s1" })));
	await until(() => heard.some((one) => one.type === "state"));
	ws.send(JSON.stringify(envelope("command", "abort", {}, { session: "s1", id: "c1" })));
	await until(() => bridge.asked.some((one) => one.id === "c1"));
	bridge.reply("c1", "abort", {});
	await until(() => heard.some((one) => one.kind === "reply" && one.id === "c1"));
	ws.close();
});

test("a tailscale that does not answer keeps the machines found last", async () => {
	const { machines, laptop } = await twoMachines();
	let silenced = false;
	const silent = new Machines({
		self: "desk",
		originOf: () => `http://127.0.0.3:${laptop.clientPort}`,
		ask: async (args) => (silenced ? undefined : ask(args)),
	});
	await silent.look();
	silenced = true;
	await silent.look();
	expect(silent.list().map((one) => one.name)).toEqual(machines.list().map((one) => one.name));
	expect(silent.list().length).toBe(1);
});

test("a machine that stops answering leaves the list at the next look", async () => {
	const { laptop, machines, get } = await twoMachines();
	laptop.stop();
	await machines.look();
	expect(machines.list()).toEqual([]);
	expect(await get("/sessions")).toEqual([]);
});

test("the machine list puts this one first, then the others with their version", async () => {
	const { get } = await twoMachines();
	const listed = (await get("/tailnet")) as { name: string; here: boolean; version: string }[];
	expect(listed.map(({ name, here, version }) => ({ name, here, version }))).toEqual([
		{ name: "desk", here: true, version: "1.2.0" },
		{ name: "laptop", here: false, version: "1.2.0" },
	]);
});

test("a machine that stops answering stays on the machine list, with when it last answered", async () => {
	const { laptop, machines, get } = await twoMachines();
	const before = Date.now();
	laptop.stop();
	await machines.look();
	const listed = (await get("/tailnet")) as { name: string; answering: boolean; seen: number }[];
	const gone = listed.find((one) => one.name === "laptop");
	expect(gone?.answering).toBe(false);
	expect(gone?.seen).toBeLessThanOrEqual(before);
});

/** A presence entry as the kit writes it, for a session of `host` whose process is this one. */
function openOn(events: string, session: string, host: string): void {
	mkdirSync(join(events, "live"), { recursive: true });
	const entry = {
		session,
		pid: process.pid,
		host,
		cwd: "/repo",
		state: "idle",
		startedAt: 1,
		at: 1,
	};
	writeFileSync(join(events, "live", `${session}.json`), JSON.stringify(entry));
}

test("the other machine's open sessions and its rooms are copied here, and only what is new", async () => {
	const { machines } = await twoMachines();
	const there = join(dir, "laptop", "events");
	const here = join(dir, "desk", "events");
	openOn(there, "s1", "laptop");
	openOn(here, "d1", "desk");
	mkdirSync(join(there, "rooms", "r1"), { recursive: true });
	const log = join(there, "rooms", "r1", "s1.jsonl");
	writeFileSync(log, '{"line":1}\n');
	const mirror = new Mirror({ machines, root: here, self: "desk" });

	await mirror.sync();
	expect(JSON.parse(readFileSync(join(here, "live", "s1.json"), "utf8")).host).toBe("laptop");
	expect(readFileSync(join(here, "rooms", "r1", "s1.jsonl"), "utf8")).toBe('{"line":1}\n');

	appendFileSync(log, '{"line":2}\n');
	await mirror.sync();
	expect(readFileSync(join(here, "rooms", "r1", "s1.jsonl"), "utf8")).toBe(
		'{"line":1}\n{"line":2}\n',
	);

	// What this machine writes is never copied back over itself, and its own entries stay.
	expect(existsSync(join(there, "live", "d1.json"))).toBe(false);
	expect(existsSync(join(here, "live", "d1.json"))).toBe(true);
});

test("a machine that leaves takes its open sessions with it, and the rooms stay", async () => {
	const { laptop, machines } = await twoMachines();
	const there = join(dir, "laptop", "events");
	const here = join(dir, "desk", "events");
	openOn(there, "s1", "laptop");
	mkdirSync(join(there, "rooms", "r1"), { recursive: true });
	writeFileSync(join(there, "rooms", "r1", "s1.jsonl"), '{"line":1}\n');
	const mirror = new Mirror({ machines, root: here, self: "desk" });
	await mirror.sync();
	expect(existsSync(join(here, "live", "s1.json"))).toBe(true);

	laptop.stop();
	await machines.look();
	await mirror.sync();
	expect(existsSync(join(here, "live", "s1.json"))).toBe(false);
	expect(existsSync(join(here, "rooms", "r1", "s1.jsonl"))).toBe(true);
});

test("a log is a name in a room, never a path", async () => {
	const { get } = await twoMachines();
	expect(await get("/rooms/..%2F..%2Flive/s1.json")).toEqual({ error: "no such log" });
	expect(await get("/rooms/r1/.env")).toEqual({ error: "no such log" });
});
