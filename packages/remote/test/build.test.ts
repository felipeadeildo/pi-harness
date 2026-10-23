import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Built, buildRemote, foreign, nodeBuiltins } from "../build.ts";
import { run } from "../src/cli/run.ts";
import { VERSION } from "../src/version.ts";

/** Node, which runs the built files outside pi. Bun would hide a file that only Bun can run. */
const NODE = Bun.which("node");

let outdir = "";
let built: Built;
const builtins = nodeBuiltins();

beforeAll(async () => {
	outdir = mkdtempSync(join(tmpdir(), "pi-remote-build-"));
	built = await buildRemote(outdir);
});

afterAll(() => {
	rmSync(outdir, { recursive: true, force: true });
});

/** Runs the command and keeps what it printed. */
function command(args: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = run(
		args,
		(line) => out.push(line),
		(line) => err.push(line),
	);
	return { code, out, err };
}

describe("the built daemon and command", () => {
	test("import nothing but Node's own modules", () => {
		expect(foreign(built.outside, builtins)).toEqual([]);
	});

	test("run under Node and report the package's version", () => {
		expect(NODE).not.toBeNull();
		for (const file of [built.files["cli.js"], built.files["daemon.js"]]) {
			const result = spawnSync(NODE ?? "node", [file, "--version"], { encoding: "utf8" });
			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe(VERSION);
		}
	});

	test("anything but a module of Node's counts as foreign, even what Bun calls its own", () => {
		const outside = ["node:fs", "events", "http", "ws", "@earendil-works/pi-coding-agent"];
		expect(foreign(outside, builtins)).toEqual(["ws", "@earendil-works/pi-coding-agent"]);
	});
});

describe("the command", () => {
	test("prints its version", () => {
		expect(command(["--version"])).toEqual({ code: 0, out: [VERSION], err: [] });
	});

	test("names a command it does not know, and shows the usage", () => {
		const result = command(["serve"]);
		expect(result.code).toBe(2);
		expect(result.err.join("\n")).toContain('unknown command "serve"');
		expect(command([]).code).toBe(2);
	});
});
