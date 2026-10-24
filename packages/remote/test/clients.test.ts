import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect as dial, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connect, memoryCache, type Transport } from "@adeildo/pi-remote-client";
import { type By, envelope, type Envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { requestLink } from "../src/cli/open.ts";
import { FILES, History, type Page } from "../src/daemon/history.ts";
import { Daemon } from "../src/daemon/server.ts";
import { envelopeOf, line, Lines } from "../src/wire/lines.ts";
import { frame, Frames, MAX_MESSAGE } from "../src/wire/websocket.ts";
import { until } from "./fakes.ts";
import { logIn } from "./login.ts";

let dir: string;
let socket: string;
const running: Daemon[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-remote-clients-"));
	socket = join(dir, "remote", "daemon.sock");
});

afterEach(() => {
	for (const daemon of running.splice(0)) daemon.stop();
	rmSync(dir, { recursive: true, force: true });
});

async function openDaemon(): Promise<{ daemon: Daemon; port: number; cookie: string }> {
	const daemon = await Daemon.start({ socket, version: "1.2.0", clientPort: 0 });
	if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
	running.push(daemon);
	const port = daemon.clientPort;
	return { daemon, port, cookie: await logIn(daemon, port) };
}

/**
 * A bridge as the daemon sees one: a hello, `session.live`, events with a seq, and an answer to
 * `snapshot.get`, which tells whether the daemon asked for one.
 */
async function bridgeOf(session: string, epoch = "e1", file?: string) {
	const at = { machine: "laptop", session, epoch };
	const client: Socket = dial(socket);
	await new Promise<void>((resolve) => client.once("connect", () => resolve()));
	const asked: Envelope[] = [];
	const lines = new Lines();
	let seq = 0;
	const send = (type: string, data: unknown) =>
		client.write(line(envelope("event", type, data, { ...at, seq: seq++ })));
	const snapshot = (entries: unknown[]) =>
		send("snapshot", {
			snapshot: { session, machine: "laptop", cwd: "/repo", kind: "terminal" },
			entries,
		});
	client.setEncoding("utf8");
	client.on("data", (chunk: string) => {
		for (const text of lines.push(chunk)) {
			const message = envelopeOf(text);
			if (message?.kind === "command") asked.push(message);
		}
	});
	client.write(line(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, at)));
	client.write(
		line(
			envelope(
				"event",
				"session.live",
				{
					pid: 1,
					startedAt: 1,
					cwd: "/repo",
					kind: "terminal",
					...(file === undefined ? {} : { file }),
				},
				at,
			),
		),
	);
	const reply = (id: string, type: string, data: unknown) =>
		client.write(line(envelope("reply", type, data, { ...at, id })));
	return { send, snapshot, asked, reply, close: () => client.destroy() };
}

/** The P3 client over a real WebSocket, so the daemon is held to what the app will send. */
function transportTo(port: number, cookie: string) {
	return (onMessage: (envelope: unknown) => void, onClose: () => void): Transport => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		const queued: string[] = [];
		ws.onopen = () => {
			for (const text of queued.splice(0)) ws.send(text);
		};
		ws.onmessage = (event) => onMessage(JSON.parse(String(event.data)));
		ws.onclose = () => onClose();
		return {
			send: (message) => {
				const text = JSON.stringify(message);
				if (ws.readyState === WebSocket.OPEN) ws.send(text);
				else queued.push(text);
			},
			close: () => ws.close(),
		};
	};
}

function entry(id: string, parentId: string | null) {
	return { type: "message", id, parentId, timestamp: "", message: { role: "user", content: id } };
}

describe("a client of the daemon", () => {
	test("opens a session from the snapshot and the events after it, then follows it live", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		bridge.send("entry", entry("b", "a"));
		bridge.send("mode.changed", { mode: "judge" });
		await until(() => daemon.sessions.get("s1")?.facts.mode === "judge");

		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port, cookie),
		});
		await client.load();
		await until(() => client.session().entries.length === 2);
		expect(client.session().facts).toEqual([{ type: "mode.changed", data: { mode: "judge" } }]);

		bridge.send("entry", entry("c", "b"));
		await until(() => client.session().entries.length === 3);
		expect(client.session().cursor).toMatchObject({ epoch: "e1", seq: 3, entry: "c" });
		client.stop();
	});

	test("two sessions reach one client, and closing one keeps the other", async () => {
		const { port, cookie } = await openDaemon();
		const first = await bridgeOf("s1");
		const second = await bridgeOf("s2");
		first.snapshot([entry("a", null)]);
		second.snapshot([entry("x", null)]);
		const open = (session: string) =>
			connect({
				key: { machine: "laptop", session },
				cache: memoryCache(),
				open: transportTo(port, cookie),
			});
		const one = open("s1");
		const two = open("s2");
		await Promise.all([one.load(), two.load()]);
		await until(() => one.session().entries.length === 1 && two.session().entries.length === 1);

		first.close();
		second.send("entry", entry("y", "x"));
		await until(() => two.session().entries.length === 2);
		expect(one.session().entries.map((one) => one.id)).toEqual(["a"]);
		one.stop();
		two.stop();
	});

	test("a cursor it can resume from gets only what it missed", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		for (const id of ["b", "c", "d"]) bridge.send("entry", entry(id, null));
		await until(() => daemon.sessions.after("s1", { epoch: "e1", seq: 0 })?.length === 3);

		const got: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		ws.onmessage = (event) => got.push(JSON.parse(String(event.data)));
		await new Promise((resolve) => (ws.onopen = resolve));
		const at = { machine: "laptop", session: "s1" };
		ws.send(JSON.stringify(envelope("hello", "hello", { cursor: { epoch: "e1", seq: 2 } }, at)));
		await until(() => got.length === 1);
		expect(got.map((one) => [one.type, one.seq])).toEqual([["entry", 3]]);
		ws.close();
	});

	test("with no snapshot to give, the daemon asks the bridge, and its answer reaches the client", async () => {
		const { port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port, cookie),
		});
		await client.load();
		await until(() => bridge.asked.length === 1);
		expect(bridge.asked[0]).toMatchObject({ kind: "command", type: "snapshot.get", session: "s1" });
		bridge.snapshot([entry("a", null)]);
		await until(() => client.session().entries.length === 1);
		client.stop();
	});

	test("a client that comes before the bridge gets the session once the bridge registers it", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port, cookie),
		});
		await client.load();
		await until(() => daemon.watched().get("s1") === 1);
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		await until(() => client.session().entries.length === 1);
		client.stop();
		// Once nobody watches, the session leaves no entry behind.
		await until(() => daemon.watched().size === 0);
	});

	test("a snapshot carries the facts before it, without a closed question or a replaced mode", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.send("mode.changed", { mode: "manual" });
		bridge.send("ask.opened", { id: "q1", source: "ask-questions", questions: [] });
		bridge.send("ask.closed", { id: "q1", result: { answers: [], cancelled: true } });
		bridge.send("mode.changed", { mode: "full" });
		bridge.snapshot([]);
		// A fact after the snapshot reaches a client through the replay, not inside the snapshot.
		bridge.send("mode.changed", { mode: "judge" });
		await until(() => daemon.sessions.get("s1")?.facts.mode === "judge");

		const response = await fetch(`http://127.0.0.1:${port}/sessions/laptop/s1/snapshot`, {
			headers: { Cookie: cookie },
		});
		const snapshot = (await response.json()) as Envelope & { data: { facts: unknown[] } };
		expect(snapshot.data.facts).toEqual([{ type: "mode.changed", data: { mode: "full" } }]);
	});

	test("the HTTP routes: health, the session list, and a snapshot only for a known machine", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		const get = (path: string) =>
			fetch(`http://127.0.0.1:${port}${path}`, { headers: { Cookie: cookie } });
		await until(() => daemon.sessions.get("s1")?.snapshot !== undefined);

		expect(await (await get("/health")).json()).toMatchObject({
			version: "1.2.0",
			protocol: PROTOCOL,
		});
		const list = (await (await get("/sessions")).json()) as unknown[];
		expect(list).toMatchObject([{ machine: "laptop", session: "s1", connected: true }]);
		expect((await get("/sessions/desktop/s1/snapshot")).status).toBe(404);
		expect((await get("/nowhere")).status).toBe(404);
		// A segment that does not decode is refused, and the daemon goes on answering.
		expect((await get("/sessions/laptop/%E0%A4%A/snapshot")).status).toBe(400);
		expect((await get("/sessions/laptop/s%31/snapshot")).status).toBe(200);
		expect((await get("/health")).status).toBe(200);
	});
});

describe("logging in", () => {
	test("with no login, the session list, a snapshot, a page and the WebSocket answer 401, and health does not", async () => {
		const { port } = await openDaemon();
		const origin = `http://127.0.0.1:${port}`;
		expect((await fetch(`${origin}/sessions`)).status).toBe(401);
		expect((await fetch(`${origin}/sessions/laptop/s1/snapshot`)).status).toBe(401);
		expect((await fetch(`${origin}/sessions/laptop/s1/entries?before=b`)).status).toBe(401);
		expect((await fetch(`${origin}/health`)).status).toBe(200);
		expect(
			(await fetch(`${origin}/sessions`, { headers: { Cookie: "pi_remote=forged" } })).status,
		).toBe(401);
		const opened = await new Promise<boolean>((resolve) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin } });
			ws.onopen = () => resolve(true);
			ws.onerror = () => resolve(false);
		});
		expect(opened).toBe(false);
	});

	test("the pi-remote command gets a link on the socket, whose token trades once for an HttpOnly cookie", async () => {
		const { daemon, port } = await openDaemon();
		const link = await requestLink(socket);
		// Port 0 took a free port, so a link that guessed 7878 would lead nowhere.
		const prefix = `http://127.0.0.1:${port}/#token=`;
		if (!("url" in link) || !link.url.startsWith(prefix)) throw new Error("no link to this port");
		const token = link.url.slice(prefix.length);
		expect(daemon.sessions.list()).toEqual([]);
		const post = (body: string, query = "") =>
			fetch(`http://127.0.0.1:${port}/login${query}`, {
				method: "POST",
				headers: { Origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
				body,
			});
		// The token is read from the body only, never from the query, which access logs keep.
		expect((await post("", `?token=${token}`)).status).toBe(401);
		const traded = await post(JSON.stringify({ token }));
		expect(traded.status).toBe(204);
		const set = traded.headers.get("set-cookie") ?? "";
		expect(set).toContain("HttpOnly");
		expect(set).toContain("SameSite=Strict");
		expect((await post(JSON.stringify({ token }))).status).toBe(401);
		const cookie = set.split(";")[0] ?? "";
		expect(
			(await fetch(`http://127.0.0.1:${port}/sessions`, { headers: { Cookie: cookie } })).status,
		).toBe(200);
	});

	test("a login body past one token is cut at once, and the daemon goes on trading tokens", async () => {
		const { daemon, port } = await openDaemon();
		const huge = await fetch(`http://127.0.0.1:${port}/login`, {
			method: "POST",
			headers: { Origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
			body: JSON.stringify({ token: "x".repeat(8 * 1024 * 1024) }),
		}).catch(() => undefined);
		// The daemon answers 413 and closes; a client still sending may see the close instead.
		if (huge !== undefined) expect(huge.status).toBe(413);
		expect((await logIn(daemon, port)).startsWith("pi_remote=")).toBe(true);
	});

	test("a client's command reaches the session's bridge, and the answer comes back to it alone", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1") !== undefined);
		const origin = `http://127.0.0.1:${port}`;
		const open = async (): Promise<{ ws: WebSocket; heard: Envelope[] }> => {
			const heard: Envelope[] = [];
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
				headers: { Origin: origin, Cookie: cookie },
			});
			ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
			await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
			const at = { machine: "laptop", session: "s1" };
			ws.send(JSON.stringify(envelope("hello", "s1", {}, at)));
			await until(() => heard.length > 0);
			return { ws, heard };
		};
		const asker = await open();
		const other = await open();
		const by = { kind: "client", name: "phone", machine: "laptop" } as const;
		asker.ws.send(
			JSON.stringify(
				envelope("command", "session.rename", { name: "release" }, { session: "s1", id: "c1", by }),
			),
		);
		await until(() => bridge.asked.some((one) => one.type === "session.rename"));
		const sent = bridge.asked.find((one) => one.type === "session.rename");
		// The bridge only reads a command stamped for its own session and life.
		expect(sent).toMatchObject({ kind: "command", machine: "laptop", session: "s1", epoch: "e1" });
		bridge.reply(sent?.id ?? "", "session.rename", {});
		await until(() => asker.heard.some((one) => one.kind === "reply" && one.id === "c1"));
		expect(asker.heard.find((one) => one.kind === "reply")).toMatchObject({
			type: "session.rename",
			id: "c1",
		});
		// The window that only watches the session never sees the answer to another window's command.
		await Bun.sleep(20);
		expect(other.heard.some((one) => one.kind === "reply")).toBe(false);
		asker.ws.close();
		other.ws.close();
		bridge.close();
	});

	test("a second client asking with an id in flight is refused, and the first keeps its answer", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1") !== undefined);
		const origin = `http://127.0.0.1:${port}`;
		const open = async (): Promise<{ ws: WebSocket; heard: Envelope[] }> => {
			const heard: Envelope[] = [];
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
				headers: { Origin: origin, Cookie: cookie },
			});
			ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
			await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
			ws.send(JSON.stringify(envelope("hello", "s1", {}, { machine: "laptop", session: "s1" })));
			await until(() => heard.length > 0);
			return { ws, heard };
		};
		const first = await open();
		const second = await open();
		const ask = (ws: WebSocket) =>
			ws.send(
				JSON.stringify(
					envelope(
						"command",
						"run.abort",
						{},
						{
							session: "s1",
							id: "c1",
							by: { kind: "client", name: "phone", machine: "laptop" },
						},
					),
				),
			);
		ask(first.ws);
		await until(() => bridge.asked.some((one) => one.type === "run.abort"));
		ask(second.ws);
		await until(() => second.heard.some((one) => one.kind === "error" && one.id === "c1"));
		expect(second.heard.find((one) => one.kind === "error" && one.id === "c1")?.data).toMatchObject(
			{
				reason: "a command with that id is already in flight",
			},
		);
		// The bridge saw it once, and its answer goes to the window that asked first.
		expect(bridge.asked.filter((one) => one.type === "run.abort")).toHaveLength(1);
		bridge.reply("c1", "run.abort", {});
		await until(() => first.heard.some((one) => one.kind === "reply" && one.id === "c1"));
		expect(second.heard.some((one) => one.kind === "reply")).toBe(false);
		first.ws.close();
		second.ws.close();
		bridge.close();
	});

	test("the clients watching a session are named, and the latest input marks the active one", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1") !== undefined);
		const origin = `http://127.0.0.1:${port}`;
		const open = async (name: string): Promise<{ ws: WebSocket; heard: Envelope[] }> => {
			const heard: Envelope[] = [];
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
				headers: { Origin: origin, Cookie: cookie },
			});
			ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
			await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
			ws.send(
				JSON.stringify(
					envelope(
						"hello",
						"hello",
						{
							by: { kind: "client", name, machine: "laptop" },
						},
						{ machine: "laptop", session: "s1" },
					),
				),
			);
			await until(() => heard.length > 0);
			return { ws, heard };
		};
		const phone = await open("phone");
		const laptop = await open("laptop");
		await until(() =>
			phone.heard.some(
				(one) =>
					one.type === "presence.changed" &&
					(one.data as { viewers: unknown[] }).viewers.length === 2,
			),
		);
		const joined = phone.heard.filter((one) => one.type === "presence.changed").at(-1)?.data as {
			viewers: { name: string }[];
			active?: { name: string };
		};
		expect(joined.viewers.map((one) => one.name).sort()).toEqual(["laptop", "phone"]);
		expect(joined.active).toBeUndefined();

		// A command is input, so whoever sends it is the one the session answers now.
		laptop.ws.send(
			JSON.stringify(
				envelope(
					"command",
					"run.abort",
					{},
					{
						session: "s1",
						id: "c1",
						by: { kind: "client", name: "laptop", machine: "laptop" },
					},
				),
			),
		);
		await until(() =>
			phone.heard.some(
				(one) =>
					one.type === "presence.changed" &&
					(one.data as { active?: { name: string } }).active?.name === "laptop",
			),
		);
		const moved = phone.heard.filter((one) => one.type === "presence.changed").at(-1)?.data as {
			active?: { name: string };
		};
		expect(moved.active?.name).toBe("laptop");

		// A second command from the same client changes nothing, so nothing is said twice.
		const before = phone.heard.filter((one) => one.type === "presence.changed").length;
		laptop.ws.send(
			JSON.stringify(
				envelope(
					"command",
					"run.abort",
					{},
					{
						session: "s1",
						id: "c2",
						by: { kind: "client", name: "laptop", machine: "laptop" },
					},
				),
			),
		);
		await until(() => bridge.asked.filter((one) => one.type === "run.abort").length === 2);
		await Bun.sleep(20);
		expect(phone.heard.filter((one) => one.type === "presence.changed")).toHaveLength(before);

		// One leaving is one viewer fewer, and the mark goes with it: nobody there has the last input.
		laptop.ws.close();
		const presence = () =>
			phone.heard.filter((one) => one.type === "presence.changed").at(-1)?.data as
				| { viewers: { name: string; machine: string }[]; active?: By }
				| undefined;
		await until(() => presence()?.viewers.length === 1);
		expect(presence()).toEqual({ viewers: [{ name: "phone", machine: "laptop" }] });
		phone.ws.close();
		bridge.close();
	});

	test("the terminal is a viewer, and typing there takes the mark from a client", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1") !== undefined);
		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		const by = { kind: "client", name: "phone", machine: "laptop" } as const;
		ws.send(
			JSON.stringify(envelope("hello", "hello", { by }, { machine: "laptop", session: "s1" })),
		);
		await until(() => heard.some((one) => one.type === "presence.changed"));
		// A client's command takes the mark.
		ws.send(JSON.stringify(envelope("command", "run.abort", {}, { session: "s1", id: "c1", by })));
		const presence = () =>
			heard.filter((one) => one.type === "presence.changed").at(-1)?.data as
				| { viewers: { name: string }[]; active?: { kind: string } }
				| undefined;
		await until(() => presence()?.active?.kind === "client");
		// And a key at the terminal takes it back, with the terminal named as the one typing there.
		bridge.send("presence.here", {
			by: { kind: "terminal", name: "otter", machine: "laptop" },
		});
		await until(() => presence()?.active?.kind === "terminal");
		expect(presence()).toMatchObject({
			viewers: [
				{ name: "otter", machine: "laptop" },
				{ name: "phone", machine: "laptop" },
			],
			active: { kind: "terminal", name: "otter" },
		});
		ws.close();
		bridge.close();
	});

	test("a session that ends forgets who was watching, so a relaunch starts clean", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1") !== undefined);
		// The terminal of the session typed, so it is a viewer and the active one.
		bridge.send("presence.here", { by: { kind: "terminal", name: "otter", machine: "laptop" } });
		await Bun.sleep(20);
		bridge.send("session.gone", { reason: "exit" });
		await until(() => daemon.sessions.get("s1")?.gone !== undefined);

		// The same session comes back under the same id, as `pi --continue` does.
		const again = await bridgeOf("s1", "e2");
		again.snapshot([]);
		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		ws.send(
			JSON.stringify(
				envelope(
					"hello",
					"hello",
					{ by: { kind: "client", name: "phone", machine: "laptop" } },
					{
						machine: "laptop",
						session: "s1",
					},
				),
			),
		);
		await until(() => heard.some((one) => one.type === "presence.changed"));
		expect(heard.find((one) => one.type === "presence.changed")?.data).toEqual({
			viewers: [{ name: "phone", machine: "laptop" }],
		});
		ws.close();
		again.close();
		bridge.close();
	});

	test("a key at the terminal reaches the others as presence, never as the keypress itself", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1") !== undefined);
		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		ws.send(
			JSON.stringify(
				envelope(
					"hello",
					"hello",
					{ by: { kind: "client", name: "phone", machine: "laptop" } },
					{
						machine: "laptop",
						session: "s1",
					},
				),
			),
		);
		await until(() => heard.length > 0);
		const before = heard.length;
		bridge.send("presence.here", { by: { kind: "terminal", name: "otter", machine: "laptop" } });
		await until(() =>
			heard.some(
				(one) =>
					one.type === "presence.changed" &&
					(one.data as { active?: { kind: string } }).active?.kind === "terminal",
			),
		);
		// What arrived is the presence, and the keypress itself was not forwarded.
		expect(heard.slice(before).map((one) => one.type)).toEqual(["presence.changed"]);
		ws.close();
		bridge.close();
	});

	test("a command for a session with no bridge answers on its id, so the client is not left waiting", async () => {
		const { port, cookie } = await openDaemon();
		const origin = `http://127.0.0.1:${port}`;
		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: origin, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		ws.send(JSON.stringify(envelope("hello", "gone", {}, { machine: "laptop", session: "gone" })));
		await until(() => heard.length > 0);
		ws.send(
			JSON.stringify(
				envelope("command", "run.abort", {}, { session: "gone", id: "c9", by: undefined }),
			),
		);
		await until(() => heard.some((one) => one.kind === "error" && one.id === "c9"));
		expect(heard.find((one) => one.kind === "error" && one.id === "c9")?.data).toMatchObject({
			reason: "no session is connected to answer this",
		});
		ws.close();
	});

	test("a bridge gets a link for token.issue, answered on the same id", async () => {
		const { port } = await openDaemon();
		const client: Socket = dial(socket);
		await new Promise<void>((resolve) => client.once("connect", () => resolve()));
		const replies: Envelope[] = [];
		const lines = new Lines();
		client.setEncoding("utf8");
		client.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const message = envelopeOf(text);
				if (message?.kind === "reply") replies.push(message);
			}
		});
		const at = { machine: "laptop", session: "s1", epoch: "e1" };
		client.write(line(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, at)));
		client.write(line(envelope("command", "token.issue", {}, { ...at, id: "c7" })));
		await until(() => replies.length === 1);
		expect(replies[0]).toMatchObject({ type: "token.issue", id: "c7" });
		const data = replies[0]?.data as { url?: unknown } | undefined;
		expect(data?.url).toStartWith(`http://127.0.0.1:${port}/#token=`);
		client.destroy();
	});

	test("a daemon that listens on no port for clients says so instead of giving a link", async () => {
		const daemon = await Daemon.start({ socket, version: "1.2.0" });
		if (daemon === undefined) throw new Error("the daemon did not start");
		running.push(daemon);
		// The message names what to do about it: a port another program holds is the operator's fix.
		const link = await requestLink(socket);
		expect("reason" in link ? link.reason : "").toContain("the port is taken by another program");
		expect("reason" in link ? link.reason : "").toContain("Alt+S › Remote");
	});
});

describe("who reaches the daemon", () => {
	/** A raw upgrade with the headers a page would send, and the status line the daemon answers. */
	async function upgrade(port: number, headers: string): Promise<string> {
		const raw = dial(port, "127.0.0.1");
		let answer = "";
		raw.setEncoding("utf8");
		raw.on("data", (chunk: string) => (answer += chunk));
		await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
		raw.write(
			`GET /ws HTTP/1.1\r\n${headers}Upgrade: websocket\r\nConnection: Upgrade\r\n` +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		await until(() => answer.includes("\r\n"));
		raw.destroy();
		return answer.slice(0, answer.indexOf("\r\n"));
	}

	test("a WebSocket from another page's Origin, or with none, is refused", async () => {
		const { port, cookie } = await openDaemon();
		const host = `Host: 127.0.0.1:${port}\r\n`;
		expect(await upgrade(port, `${host}Origin: https://evil.example\r\n`)).toBe(
			"HTTP/1.1 403 Forbidden",
		);
		expect(await upgrade(port, `${host}Origin: null\r\n`)).toStartWith("HTTP/1.1 403");
		expect(await upgrade(port, host)).toStartWith("HTTP/1.1 403");
		expect(
			await upgrade(port, `${host}Origin: http://localhost:${port}\r\nCookie: ${cookie}\r\n`),
		).toStartWith("HTTP/1.1 101");
	});

	test("a name the daemon does not answer to gets 421, so a rebound DNS name reads nothing", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		await until(() => daemon.sessions.get("s1")?.snapshot !== undefined);
		const status = (host: string) =>
			new Promise<number>((resolve) => {
				const raw = dial(port, "127.0.0.1");
				let answer = "";
				raw.setEncoding("utf8");
				raw.on("data", (chunk: string) => (answer += chunk));
				raw.on("close", () => resolve(Number(answer.split(" ")[1])));
				raw.write(
					`GET /sessions/laptop/s1/snapshot HTTP/1.1\r\nHost: ${host}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`,
				);
			});
		expect(await status(`attacker.example:${port}`)).toBe(421);
		expect(await status(`127.0.0.1:${port}`)).toBe(200);
		expect(
			await upgrade(
				port,
				`Host: attacker.example:${port}\r\nOrigin: http://attacker.example:${port}\r\n`,
			),
		).toStartWith("HTTP/1.1 421");
	});
});

/** A frame as a client sends it: masked, with the length form its size needs. */
function clientFrame(opcode: number, payload: Buffer, final = true): Buffer {
	const mask = Buffer.from([1, 2, 3, 4]);
	const body = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
	const server = frame(opcode, body);
	// A server frame has the same head with the mask bit off and no key, so the head is reused.
	const head = Buffer.from(server.subarray(0, server.length - body.length));
	head[0] = (final ? 0x80 : 0) | opcode;
	head[1]! |= 0x80;
	return Buffer.concat([head, mask, body]);
}

describe("WebSocket frames", () => {
	const masked = (opcode: number, text: string, final = true) => {
		const payload = Buffer.from(text);
		const mask = Buffer.from([1, 2, 3, 4]);
		const body = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
		return Buffer.concat([
			Buffer.from([(final ? 0x80 : 0) | opcode, 0x80 | body.length]),
			mask,
			body,
		]);
	};

	test("a masked message, split across chunks and fragments, reads as one", () => {
		const read: string[] = [];
		const frames = new Frames((_opcode, payload) => read.push(payload.toString()));
		const whole = Buffer.concat([masked(0x1, "hel", false), masked(0x0, "lo")]);
		expect(frames.push(whole.subarray(0, 5))).toBeUndefined();
		expect(frames.push(whole.subarray(5))).toBeUndefined();
		expect(read).toEqual(["hello"]);
	});

	test("a ping between two fragments is read at once", () => {
		const read: number[] = [];
		const frames = new Frames((opcode) => read.push(opcode));
		frames.push(Buffer.concat([masked(0x1, "a", false), masked(0x9, ""), masked(0x0, "b")]));
		expect(read).toEqual([0x9, 0x1]);
	});

	test("a message past the limit is refused, even when it comes in fragments", () => {
		const frames = new Frames(() => {});
		expect(frames.push(clientFrame(0x1, Buffer.alloc(MAX_MESSAGE + 1)))).toBe(1009);
		const half = Buffer.alloc(MAX_MESSAGE / 2 + 1);
		const fragmented = new Frames(() => {});
		expect(fragmented.push(clientFrame(0x1, half, false))).toBeUndefined();
		expect(fragmented.push(clientFrame(0x0, half))).toBe(1009);
	});

	test("an unmasked frame from a client closes the connection as a protocol error", () => {
		const read: string[] = [];
		const frames = new Frames((_opcode, payload) => read.push(payload.toString()));
		expect(frames.push(frame(0x1, Buffer.from("hi")))).toBe(1002);
		expect(read).toEqual([]);
	});

	test("a server frame takes the shortest length form, at each edge", () => {
		// RFC 6455 wants the minimal form, and a browser fails a connection that breaks it.
		const second = (size: number) => frame(0x1, Buffer.alloc(size))[1];
		expect([125, 126, 65_535, 65_536].map(second)).toEqual([125, 126, 126, 127]);
		expect(frame(0x1, Buffer.alloc(300)).subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 1, 44]));
	});

	test("a ping gets a pong with its payload, and a close gets a close", async () => {
		const { port, cookie } = await openDaemon();
		const raw = dial(port, "127.0.0.1");
		const got: Buffer[] = [];
		raw.on("data", (chunk: Buffer) => got.push(chunk));
		await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
		raw.write(
			`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nCookie: ${cookie}\r\n` +
				"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		await until(() => Buffer.concat(got).includes("\r\n\r\n"));
		got.length = 0;
		raw.write(clientFrame(0x9, Buffer.from("beat")));
		await until(() => got.length > 0);
		expect(Buffer.concat(got).equals(frame(0xa, Buffer.from("beat")))).toBe(true);
		got.length = 0;
		raw.write(clientFrame(0x8, Buffer.from([0x03, 0xe8])));
		await until(() => got.length > 0);
		expect(Buffer.concat(got)[0]).toBe(0x88);
		raw.destroy();
	});
});

describe("a session's older entries", () => {
	/** A session file as pi writes one: the header, then entries chained by `parentId`. */
	function sessionFile(session: string, lines: unknown[]): string {
		const path = join(dir, `${session}.jsonl`);
		const header = { type: "session", version: 3, id: session, cwd: "/repo" };
		writeFileSync(path, [header, ...lines].map((one) => JSON.stringify(one)).join("\n") + "\n");
		return path;
	}

	const ids = (page: Page) => ("entries" in page ? page.entries.map((one) => one.id) : page);

	test("come in pages before an entry, walking the branch, and since one, in file order", async () => {
		// a - b - c is the branch; x hangs off a and is not on it.
		const path = sessionFile("s1", [
			entry("a", null),
			entry("b", "a"),
			entry("x", "a"),
			entry("c", "b"),
		]);
		const history = new History();
		expect(ids(await history.page(path, "s1"))).toEqual(["a", "b", "c"]);
		expect(await history.page(path, "s1", { before: "c", limit: 1 })).toMatchObject({
			entries: [{ id: "b" }],
			more: true,
		});
		expect(await history.page(path, "s1", { before: "b" })).toMatchObject({
			entries: [{ id: "a" }],
			more: false,
		});
		expect(ids(await history.page(path, "s1", { since: "b" }))).toEqual(["x", "c"]);
		expect(await history.page(path, "s1", { since: "gone" })).toEqual({ unknown: "gone" });
		// A limit is a count of entries, so a fraction rounds down the same way in both directions.
		expect(ids(await history.page(path, "s1", { before: "c", limit: 1.5 }))).toEqual(["b"]);
		expect(ids(await history.page(path, "s1", { since: "a", limit: 1.5 }))).toEqual(["b"]);
	});

	test("are read only from a file whose header names the session, skipping a line being written, and none before pi writes it", async () => {
		const path = sessionFile("s1", [entry("a", null)]);
		appendFileSync(path, '{"type":"message","id":"half');
		const history = new History();
		expect(await history.page(path, "s1")).toMatchObject({ entries: [{ id: "a" }] });
		expect(await history.page(path, "s2")).toEqual({ foreign: true });
		// Pi names the file when the session opens, and writes it at the first message.
		expect(await history.page(join(dir, "none.jsonl"), "s1")).toEqual({ entries: [], more: false });
	});

	test("follow what the file gains, and read it again when pi rewrites it", async () => {
		const path = sessionFile("s1", [entry("a", null)]);
		const history = new History();
		expect(ids(await history.page(path, "s1"))).toEqual(["a"]);
		appendFileSync(path, `${JSON.stringify(entry("b", "a"))}\n`);
		expect(ids(await history.page(path, "s1", { since: "a" }))).toEqual(["b"]);
		// A rewrite with fewer bytes, as a migration can leave, is indexed from the start.
		sessionFile("s1", [entry("z", null)]);
		expect(ids(await history.page(path, "s1"))).toEqual(["z"]);
		// And so is a rewrite in place that grew: the last entry indexed is no longer where it was.
		sessionFile("s1", [entry("q", null), entry("r", "q"), entry("s", "r")]);
		expect(ids(await history.page(path, "s1"))).toEqual(["q", "r", "s"]);
	});

	test("end the walk at a parent seen before, so a cycle never pages forever", async () => {
		const path = sessionFile("s1", [entry("x", "y"), entry("y", "x")]);
		const history = new History();
		const page = await history.page(path, "s1", { before: "y" });
		expect(page).toEqual({ entries: [expect.objectContaining({ id: "x" })], more: false });
		expect(await history.page(path, "s1")).toMatchObject({ more: false });
	});

	test("keep only the index, and an index for at most FILES files", async () => {
		const history = new History();
		const paths = Array.from({ length: FILES + 2 }, (_, at) =>
			sessionFile(`s${at}`, [entry("a", null)]),
		);
		for (const [at, path] of paths.entries()) await history.page(path, `s${at}`);
		expect(history.indexed()).toBe(FILES);
	});

	test("come over HTTP from the file the bridge named, and an unknown cursor is a 410", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const file = sessionFile("s1", [entry("a", null), entry("b", "a")]);
		const bridge = await bridgeOf("s1", "e1", file);
		bridge.snapshot([]);
		const get = (query: string, machine = "laptop") =>
			fetch(`http://127.0.0.1:${port}/sessions/${machine}/s1/entries${query}`, {
				headers: { Cookie: cookie },
			});
		await until(() => daemon.sessions.get("s1")?.live.file === file);
		const first = await get("?before=b");
		expect(await first.json()).toMatchObject({ entries: [{ id: "a" }], more: false });
		expect((await get("?since=gone")).status).toBe(410);
		expect((await get("", "desktop")).status).toBe(404);
	});
});
