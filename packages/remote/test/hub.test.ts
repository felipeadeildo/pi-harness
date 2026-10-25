import { describe, expect, test } from "bun:test";
import { connect as dial, type Socket } from "node:net";

import { connect, memoryCache } from "@adeildo/pi-remote-client";
import { envelope, type Envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { envelopeOf, line, Lines } from "../src/wire/lines.ts";
import {
	bridgeOf,
	entry,
	missed,
	openDaemon,
	socket,
	transportTo,
	useDaemon,
} from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

describe("a client of the daemon", () => {
	test("opens a session from the snapshot and the events after it, then follows it live", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		bridge.send("entry", entry("b", "a"));
		bridge.send("mode.changed", { mode: "judge" });
		await until(() => daemon.sessions.get("s1")?.state.permissions.mode === "judge");

		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port, cookie),
		});
		await client.load();
		await until(() => client.session().entries.length === 2);
		expect(client.session().state.permissions.mode).toBe("judge");

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

	test("a queue that changed reaches a client that resumes, through the replay", async () => {
		const { daemon } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1")?.snapshot !== undefined);
		const queued = {
			id: "m1",
			by: { kind: "client", name: "phone", machine: "laptop" },
			text: "waiting",
			want: "followUp",
			when: 1,
		};
		// A numbered event, so it is kept for the replay: a client that missed it reads it on resume.
		bridge.send("queue.changed", { queue: [queued] });
		await until(() => daemon.sessions.get("s1")?.state.queue.length === 1);

		// The daemon applied it with the same function the client uses, so a client that resumes from a
		// cursor before it reads the queue out of the replay instead of asking for a new snapshot.
		const replayed = daemon.sessions.after("s1", { epoch: "e1", seq: 0 }) ?? [];
		const queueEvent = replayed.find((one) => one.type === "queue.changed");
		const queuedAgain = (queueEvent?.data as { queue: { id: string }[] } | undefined)?.queue ?? [];
		expect(queuedAgain.map((one) => one.id)).toEqual(["m1"]);
	});

	test("a client that asked before the bridge came back is sent the state when it does", async () => {
		const { port, cookie } = await openDaemon();
		// A client opens a session no bridge registered yet, and says nothing back: it keeps watching.
		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		ws.send(JSON.stringify(envelope("hello", "hello", {}, { machine: "laptop", session: "s1" })));

		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		await until(() => heard.some((one) => one.kind === "event" && one.type === "state"));
		// The daemon keeps the answer, so it never asks the bridge for a second one.
		expect(bridge.asked.some((one) => one.type === "state.get")).toBe(false);
		ws.close();
		bridge.close();
	});

	test("a snapshot carries the harness state folded, and the daemon seeds its own with it", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.send("mode.changed", { mode: "manual" });
		bridge.send("ask.opened", { id: "q1", source: "ask-questions", questions: [] });
		bridge.send("ask.closed", { id: "q1", result: { answers: [], cancelled: true } });
		bridge.send("mode.changed", { mode: "full" });
		bridge.snapshot([]);
		await until(() => daemon.sessions.get("s1")?.state.permissions.mode === "full");

		const response = await fetch(`http://127.0.0.1:${port}/sessions/laptop/s1/snapshot`, {
			headers: { Cookie: cookie },
		});
		const snapshot = (await response.json()) as Envelope & {
			data: { snapshot: { state: Record<string, unknown> } };
		};
		// One shape for everyone: the mode the log ended on, and the question with its answer.
		const state = snapshot.data.snapshot.state as {
			permissions: { mode?: string };
			questions: Record<string, unknown>;
		};
		expect(state.permissions.mode).toBe("full");
		expect(state.questions).toMatchObject({ q1: { closed: true } });
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
	expect(second.heard.find((one) => one.kind === "error" && one.id === "c1")?.data).toMatchObject({
		reason: "a command with that id is already in flight",
	});
	// The bridge saw it once, and its answer goes to the window that asked first.
	expect(bridge.asked.filter((one) => one.type === "run.abort")).toHaveLength(1);
	bridge.reply("c1", "run.abort", {});
	await until(() => first.heard.some((one) => one.kind === "reply" && one.id === "c1"));
	expect(second.heard.some((one) => one.kind === "reply")).toBe(false);
	first.ws.close();
	second.ws.close();
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

describe("a daemon that answers for itself", () => {
	test("a session no bridge registered gets no answer, and the one that exists still does", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		await until(() => daemon.sessions.get("s1") !== undefined);

		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)));
		await new Promise((resolve) => (ws.onopen = resolve));
		const at = (session: string) => ({ machine: "laptop", session });
		ws.send(JSON.stringify(envelope("hello", "hello", {}, at("s2"))));
		ws.send(JSON.stringify(envelope("hello", "hello", {}, at("s1"))));
		await until(() => heard.some((one) => one.type === "state" && one.session === "s1"));
		expect(heard.filter((one) => one.session === "s2")).toEqual([]);
		ws.close();
		bridge.close();
	});

	test("a session that ended keeps the answer it gave, and a socket back mid-stream finds the same message", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		bridge.send("stream.bound", { messages: [{ stream: 1, entry: "a" }] });
		bridge.send("pi.message_update", {
			type: "message_update",
			usage: undefined,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "he" },
		});
		const open = () => {
			const heard: Envelope[] = [];
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
				headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
			});
			ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)));
			return { ws, heard };
		};
		const first = open();
		await new Promise((resolve) => (first.ws.onopen = resolve));
		first.ws.send(
			JSON.stringify(envelope("hello", "hello", {}, { machine: "laptop", session: "s1" })),
		);
		await until(() => first.heard.some((one) => one.type === "stream.bound"));
		first.ws.close();

		const second = open();
		await new Promise((resolve) => (second.ws.onopen = resolve));
		second.ws.send(
			JSON.stringify(envelope("hello", "hello", {}, { machine: "laptop", session: "s1" })),
		);
		await until(() => second.heard.some((one) => one.type === "stream.bound"));
		const bounds = second.heard.filter((one) => one.type === "stream.bound");
		expect(bounds.map((one) => one.data)).toEqual([{ messages: [{ stream: 1, entry: "a" }] }]);
		expect(missed(daemon, "s1", { epoch: "e1", seq: bounds[0]?.seq ?? -1 })).toEqual([]);
		expect(second.heard.some((one) => one.type === "pi.message_update")).toBe(false);

		bridge.send("pi.message_update", {
			type: "message_update",
			usage: undefined,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "llo" },
		});
		await until(() => second.heard.some((one) => one.type === "pi.message_update"));
		const update = second.heard.find((one) => one.type === "pi.message_update")?.data as {
			assistantMessageEvent?: { delta?: string };
		};
		expect(update.assistantMessageEvent?.delta).toBe("llo");
		second.ws.close();
		bridge.close();
	});
});
