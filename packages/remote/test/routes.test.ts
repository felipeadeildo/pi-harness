import { describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PROTOCOL } from "@adeildo/pi-remote-protocol";
import { listSessions, stateOf } from "@adeildo/pi-remote-protocol/client";

import { requestLink } from "../src/cli/open.ts";
import { FILES, History, type Page } from "../src/daemon/history.ts";
import { Daemon } from "../src/daemon/server.ts";
import { bridgeOf, dir, entry, openDaemon, running, socket, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";
import { logIn } from "./login.ts";

useDaemon();

test("the HTTP routes: health, the session list, and an opening only for a known machine", async () => {
	const { daemon, port, cookie } = await openDaemon();
	const bridge = await bridgeOf("s1");
	bridge.state([]);
	const get = (path: string) =>
		fetch(`http://127.0.0.1:${port}${path}`, { headers: { Cookie: cookie } });
	await until(() => daemon.sessions.get("s1")?.opening !== undefined);

	expect(await (await get("/health")).json()).toMatchObject({
		version: "1.2.0",
		protocol: PROTOCOL,
	});
	const list = (await (await get("/sessions")).json()) as unknown[];
	expect(list).toMatchObject([{ machine: "laptop", session: "s1", connected: true }]);
	expect((await get("/sessions/desktop/s1/opening")).status).toBe(404);
	expect((await get("/nowhere")).status).toBe(404);
	// A segment that does not decode is refused, and the daemon goes on answering.
	expect((await get("/sessions/laptop/%E0%A4%A/opening")).status).toBe(400);
	expect((await get("/sessions/laptop/s%31/opening")).status).toBe(200);
	expect((await get("/health")).status).toBe(200);
});

test("the client reads the list the daemon writes: the handle from the summary, the status from the state", async () => {
	const { daemon, port, cookie } = await openDaemon();
	const bridge = await bridgeOf("s1");
	bridge.send("session.status", { status: "blocked" });
	bridge.send("state", {
		summary: {
			session: "s1",
			machine: "laptop",
			cwd: "/repo",
			kind: "terminal",
			handle: "kestrel",
		},
		entries: [],
	});
	await until(() => daemon.sessions.get("s1")?.opening !== undefined);
	const loggedIn = ((url: string | URL, init?: RequestInit) =>
		fetch(url, { ...init, headers: { cookie } })) as typeof fetch;
	const [listed] = await listSessions(`http://127.0.0.1:${port}`, loggedIn);
	expect(listed?.summary?.handle).toBe("kestrel");
	expect(listed === undefined ? undefined : stateOf(listed)).toBe("blocked");
});

test("with no login, the session list, an opening, a page and the WebSocket answer 401, and health does not", async () => {
	const { port } = await openDaemon();
	const origin = `http://127.0.0.1:${port}`;
	expect((await fetch(`${origin}/sessions`)).status).toBe(401);
	expect((await fetch(`${origin}/sessions/laptop/s1/opening`)).status).toBe(401);
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
		bridge.state([]);
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

test("a daemon that listens on no port for clients says so instead of giving a link", async () => {
	const daemon = await Daemon.start({ socket, version: "1.2.0" });
	if (daemon === undefined) throw new Error("the daemon did not start");
	running.push(daemon);
	// The message names what to do about it: a port another program holds is the operator's fix.
	const link = await requestLink(socket);
	expect("reason" in link ? link.reason : "").toContain("no client can reach this daemon");
	expect("reason" in link ? link.reason : "").toContain("Alt+S › Remote");
});
