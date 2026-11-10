// Terminals from the page: off by default, and a tmux control-mode client per page when on.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { outputOf, Terminals } from "../src/daemon/terminal.ts";
import { dir, openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

describe("a line of tmux's control mode", () => {
	test("is a pane's output, with each \\ooo escape read back as its byte", () => {
		const line = Buffer.concat([
			Buffer.from("%output %3 echo \\033[1mhi\\015\\012back\\134slash "),
			Buffer.from("é", "utf8"),
		]);
		expect(outputOf(line)).toEqual({
			pane: "%3",
			bytes: Buffer.concat([
				Buffer.from("echo \x1b[1mhi\r\nback\\slash "),
				Buffer.from("é", "utf8"),
			]),
		});
	});

	test("anything else is not output", () => {
		expect(outputOf(Buffer.from("%begin 1 2 1"))).toBeUndefined();
		expect(outputOf(Buffer.from("%output"))).toBeUndefined();
	});
});

/** The daemon's name for itself, which follows the host. */
async function machineOf(origin: string): Promise<string> {
	return ((await (await fetch(`${origin}/health`)).json()) as { machine: string }).machine;
}

test("off by default: no list, no new shell, and no socket", async () => {
	const { port, cookie } = await openDaemon();
	const origin = `http://127.0.0.1:${port}`;
	const here = await machineOf(origin);
	const headers = { cookie, origin, "content-type": "application/json" };
	const listed = await fetch(`${origin}/machines/${here}/terminals`, { headers });
	expect(await listed.json()).toEqual({ allowed: false, terminals: [] });
	const made = await fetch(`${origin}/machines/${here}/terminals`, {
		method: "POST",
		headers,
		body: JSON.stringify({ folder: dir }),
	});
	expect([made.status, await made.json()]).toEqual([
		403,
		{
			error: `terminals from the page are off on ${here}: turn on "remote.terminal" in pi's settings there`,
		},
	]);
	const opened = await new Promise<boolean>((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal?name=x&cols=80&rows=24`, {
			headers: { Origin: origin, Cookie: cookie },
		});
		ws.onopen = () => resolve(true);
		ws.onerror = () => resolve(false);
	});
	expect(opened).toBe(false);
});

const hasTmux = spawnSync("tmux", ["-V"]).status === 0;

// CI installs tmux, so these run there.
describe.skipIf(!hasTmux)("a terminal in a real tmux", () => {
	let previous: { TMUX_TMPDIR: string | undefined; TMUX: string | undefined };

	beforeEach(() => {
		previous = { TMUX_TMPDIR: process.env.TMUX_TMPDIR, TMUX: process.env.TMUX };
		process.env.TMUX_TMPDIR = dir;
		delete process.env.TMUX;
	});

	afterEach(() => {
		spawnSync("tmux", ["-L", "pi-remote", "kill-server"], { stdio: "ignore" });
		if (previous.TMUX_TMPDIR === undefined) delete process.env.TMUX_TMPDIR;
		else process.env.TMUX_TMPDIR = previous.TMUX_TMPDIR;
		if (previous.TMUX !== undefined) process.env.TMUX = previous.TMUX;
	});

	async function opened() {
		const { port, cookie } = await openDaemon({
			terminals: new Terminals({ allowed: () => true }),
		});
		const origin = `http://127.0.0.1:${port}`;
		const here = await machineOf(origin);
		const headers = { cookie, origin, "content-type": "application/json" };
		const folder = join(dir, "work");
		mkdirSync(folder, { recursive: true });
		const made = await fetch(`${origin}/machines/${here}/terminals`, {
			method: "POST",
			headers,
			body: JSON.stringify({ folder }),
		});
		const { name } = (await made.json()) as { name: string };
		const list = async () =>
			(
				(await (await fetch(`${origin}/machines/${here}/terminals`, { headers })).json()) as {
					terminals: { name: string; folder: string }[];
				}
			).terminals;
		/** A page on the terminal: what it has drawn so far, and how it closed. */
		const page = (cols = 80, rows = 24) => {
			const ws = new WebSocket(
				`ws://127.0.0.1:${port}/terminal?name=${name}&cols=${cols}&rows=${rows}`,
				{ headers: { Origin: origin, Cookie: cookie } },
			);
			ws.binaryType = "arraybuffer";
			const seen = { text: "", closed: undefined as { code: number; reason: string } | undefined };
			ws.onmessage = (event) => {
				seen.text += Buffer.from(event.data as ArrayBuffer).toString("utf8");
			};
			ws.onclose = (event) => {
				seen.closed = { code: event.code, reason: event.reason };
			};
			const send = (message: unknown) => ws.send(JSON.stringify(message));
			return { ws, seen, send, open: new Promise((resolve) => (ws.onopen = resolve)) };
		};
		return { made, name, folder, list, page, origin, here, cookie, port };
	}

	test("a new shell opens in its folder and is listed there", async () => {
		const { made, name, folder, list } = await opened();
		expect(made.status).toBe(201);
		expect(name).toMatch(/^shell-[0-9a-f]{4}$/);
		// The pane reports its folder once the shell is up.
		let listed = await list();
		for (const end = Date.now() + 2_000; listed[0]?.folder !== folder && Date.now() < end;)
			listed = await list();
		expect(listed).toMatchObject([{ name, folder }]);
	});

	test("a screen that shows tmux's own words is still a screen when a page comes back", async () => {
		const { page } = await opened();
		const one = page();
		await one.open;
		// tmux's own words on the screen, then a mark that only the output holds.
		one.send({
			type: "input",
			data: "printf '%s\\n' '%end 1 2 1' '%exit'; printf '%s-%s\\n' after them\r",
		});
		await until(() => one.seen.text.includes("after-them"));
		one.ws.close();
		await until(() => one.seen.closed !== undefined);
		const two = page();
		await until(() => two.seen.text.includes("after-them"));
		await Bun.sleep(300);
		expect(two.seen.closed).toBeUndefined();
	});

	test("a name that is not a plain one never reaches tmux, even when tmux has that session", async () => {
		const { port, origin, cookie, list, name } = await opened();
		const hostile = "x';kill-server;'";
		execFileSync("tmux", ["-L", "pi-remote", "new-session", "-d", "-s", hostile]);
		const ws = new WebSocket(
			`ws://127.0.0.1:${port}/terminal?${new URLSearchParams({ name: hostile, cols: "80", rows: "24" })}`,
			{ headers: { Origin: origin, Cookie: cookie } },
		);
		const closed = await new Promise<number>((resolve) => {
			ws.onclose = (event) => resolve(event.code);
		});
		expect(closed).toBe(4404);
		expect((await list()).map((one) => one.name).toSorted()).toEqual([name, hostile].toSorted());
	});

	test("a page that gives no size gets a plain 80x24", async () => {
		const { port, origin, cookie, name } = await opened();
		const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal?name=${name}`, {
			headers: { Origin: origin, Cookie: cookie },
		});
		await new Promise((resolve) => (ws.onopen = resolve));
		const size = () =>
			execFileSync(
				"tmux",
				["-L", "pi-remote", "display", "-p", "-t", `=${name}:`, "#{window_width}x#{window_height}"],
				{ encoding: "utf8" },
			).trim();
		await until(() => size() === "80x24");
		ws.close();
	});

	test("what the page types runs, and its output comes back", async () => {
		const { page } = await opened();
		const one = page();
		await one.open;
		// The output differs from what was typed, so seeing it proves the command ran, in any shell.
		one.send({ type: "input", data: "printf '%s-%s\\n' from-the page\r" });
		await until(() => one.seen.text.includes("from-the-page"));
	});

	test("the page sets the size, and a page that comes back sees the screen as it was, once", async () => {
		const { page, name } = await opened();
		const one = page(100, 30);
		await one.open;
		// Only the output holds the mark: the typed line has a space where the output has a dash.
		one.send({ type: "input", data: "printf '%s-%s\\n' only once\r" });
		await until(() => one.seen.text.includes("only-once"));
		const size = () =>
			execFileSync(
				"tmux",
				["-L", "pi-remote", "display", "-p", "-t", `=${name}:`, "#{window_width}x#{window_height}"],
				{ encoding: "utf8" },
			).trim();
		expect(size()).toBe("100x30");
		one.send({ type: "resize", cols: 72, rows: 20 });
		await until(() => size() === "72x20");
		one.ws.close();
		await until(() => one.seen.closed !== undefined);
		const two = page(72, 20);
		await until(() => two.seen.text.includes("only-once"));
		// Drawn from the screen, and never again from output tmux may still hold.
		await Bun.sleep(300);
		expect(two.seen.text.split("only-once").length - 1).toBe(1);
	});

	test("the shell ending closes the page with the reason, and the terminal leaves the list", async () => {
		const { page, list } = await opened();
		const one = page();
		await one.open;
		one.send({ type: "input", data: "exit\r" });
		await until(() => one.seen.closed !== undefined);
		expect(one.seen.closed).toEqual({ code: 1000, reason: "the shell ended" });
		expect(await list()).toEqual([]);
	});

	test("a terminal that is not there closes the socket with a 404 in its code", async () => {
		const { port, origin, cookie } = await opened();
		const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal?name=nope&cols=80&rows=24`, {
			headers: { Origin: origin, Cookie: cookie },
		});
		const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
			ws.onclose = (event) => resolve({ code: event.code, reason: event.reason });
		});
		expect(closed.code).toBe(4404);
		expect(closed.reason).toStartWith("no terminal named nope on ");
	});
});
