import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRemote } from "../build.ts";
import {
	type Current,
	readCurrent,
	startDaemon,
	writeHolder,
	writeLauncher,
} from "../src/launcher.ts";
import { VERSION } from "../src/version.ts";
import { until } from "./fakes.ts";

const NODE = Bun.which("node") ?? "node";

let root = "";
let current: Current;

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "pi-remote-launcher-"));
	const built = await buildRemote(join(root, "dist"));
	current = {
		node: NODE,
		cli: built.files["cli.js"],
		daemon: built.files["daemon.js"],
		version: VERSION,
	};
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

function launch(launcher: string, ...args: string[]) {
	return spawnSync("sh", [launcher, ...args], { encoding: "utf8" });
}

describe("the launcher", () => {
	test("runs the command current.json names", () => {
		const dir = join(root, "remote");
		writeLauncher(dir, current);
		const result = launch(join(dir, "bin", "pi-remote"), "--version");
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe(VERSION);
		expect(statSync(join(dir, "bin", "pi-remote")).mode & 0o111).not.toBe(0);
		expect(readFileSync(join(dir, "current.sh"), "utf8")).toContain(`version='${VERSION}'`);
	});

	test("works through a link, and with quotes, spaces and a dollar in every path", () => {
		const odd = join(root, `it's a "remote" $HOME`);
		const built = join(odd, "dist");
		mkdirSync(built, { recursive: true });
		copyFileSync(current.cli, join(built, "cli.js"));
		const dir = join(odd, "remote");
		writeLauncher(dir, { ...current, cli: join(built, "cli.js") });
		const links = join(root, "links");
		mkdirSync(links, { recursive: true });
		symlinkSync(join(dir, "bin", "pi-remote"), join(links, "pi-remote"));
		const result = launch(join(links, "pi-remote"), "--version");
		expect(result.stderr).toBe("");
		expect(result.stdout.trim()).toBe(VERSION);
	});

	test("keeps its own file when nothing changed, and rewrites current.json every time", () => {
		const dir = join(root, "again");
		writeLauncher(dir, current);
		const launcher = join(dir, "bin", "pi-remote");
		const before = statSync(launcher).ino;
		writeLauncher(dir, { ...current, version: "9.9.9" });
		expect(statSync(launcher).ino).toBe(before);
		expect(JSON.parse(readFileSync(join(dir, "current.json"), "utf8")).version).toBe("9.9.9");
	});

	test("says what to build when the command is not built", () => {
		const dir = join(root, "unbuilt");
		writeLauncher(dir, { ...current, cli: join(root, "nowhere", "cli.js") });
		const result = launch(join(dir, "bin", "pi-remote"), "--version");
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("is not built");
	});
});

describe("starting the daemon", () => {
	test("reads what current.json names, and nothing that is not what a pi wrote", () => {
		const dir = join(root, "read");
		writeLauncher(dir, current);
		expect(readCurrent(dir)).toEqual(current);
		writeFileSync(join(dir, "current.json"), '{"node": 1}');
		expect(readCurrent(dir)).toBeUndefined();
		writeFileSync(join(dir, "current.json"), "not json");
		expect(readCurrent(dir)).toBeUndefined();
		expect(readCurrent(join(root, "nowhere"))).toBeUndefined();
	});

	test("starts the daemon current.json names, apart from this process, on the port it was given", async () => {
		const dir = join(root, "start");
		mkdirSync(dir, { recursive: true });
		const marker = join(dir, "started");
		const daemon = join(dir, "daemon.js");
		// The daemon writes what it was started with, which is how the port reaches it at all.
		writeFileSync(
			daemon,
			`require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));\n`,
		);
		writeLauncher(dir, { ...current, daemon });
		startDaemon(dir, 8123);
		await until(() => existsSync(marker));
		expect(readFileSync(marker, "utf8")).toBe("--port 8123");
	});

	test("says what is missing when no pi wrote current.json", () => {
		expect(() => startDaemon(join(root, "nowhere"), 7878)).toThrow(
			"current.json names no daemon to start",
		);
	});
});

describe("who holds the socket", () => {
	test("is written where a reader looks, with the port it listens on", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-remote-holder-"));
		try {
			writeLauncher(dir, current);
			writeHolder(dir, { pid: 4242, port: 7911 });
			const written = JSON.parse(readFileSync(join(dir, "current.json"), "utf8"));
			expect(written).toMatchObject({ pid: 4242, port: 7911, version: current.version });
			// The rest of the file survives the daemon saying who it is.
			expect(written.node).toBe(current.node);
			expect(readCurrent(dir)?.pid).toBe(4242);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("is not written into a folder with no launcher, which is one nobody started", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-remote-holder-"));
		try {
			writeHolder(dir, { pid: 4242, port: 7911 });
			expect(existsSync(join(dir, "current.json"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
