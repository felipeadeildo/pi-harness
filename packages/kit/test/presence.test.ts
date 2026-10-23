import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type PresenceEntry,
	processLives,
	processStart,
	readPresence,
	removePresence,
	startFromStat,
	writePresence,
} from "../src/presence/index.ts";

/** A pid no process holds: above the largest pid Linux and macOS hand out. */
const GONE = 2 ** 22 + 1;

describe("the start of a process", () => {
	test("is field 22 of /proc/<pid>/stat, counted after the command name", () => {
		const fields = Array.from({ length: 50 }, (_, index) => String(index + 3)).join(" ");
		expect(startFromStat(`4242 (pi) ${fields}`)).toBe("22");
		expect(startFromStat(`4242 (my (odd) name) ) ${fields}`)).toBe("22");
		expect(startFromStat("4242 (pi) S 1 2")).toBeUndefined();
		expect(startFromStat("garbage")).toBeUndefined();
	});

	test("reads the same for a running process every time, and nothing for a pid nobody holds", () => {
		if (process.platform !== "linux" && process.platform !== "darwin") return;
		const start = processStart(process.pid);
		expect(start).toBeString();
		expect(processStart(process.pid)).toBe(start);
		expect(processStart(GONE)).toBeUndefined();
	});
});

describe("whether the process that wrote an entry runs", () => {
	test("a pid that runs with the start it recorded is the same process", () => {
		expect(processLives(4242, "100", () => "100")).toBe(true);
	});

	test("a pid the system gave to a later process is not", () => {
		expect(processLives(4242, "100", () => "250")).toBe(false);
		expect(processLives(4242, "100", () => undefined)).toBe(false);
	});

	test("an entry with no start, written before starts were recorded, is judged by its pid", () => {
		expect(processLives(process.pid, undefined)).toBe(true);
		expect(processLives(GONE, undefined)).toBe(false);
	});
});

describe("the index of open sessions", () => {
	let root = "";
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "presence-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function entry(session: string, extra: Partial<PresenceEntry> = {}): PresenceEntry {
		return {
			session,
			pid: 4242,
			host: "laptop",
			cwd: "/work",
			state: "idle",
			startedAt: 1,
			at: 1,
			...extra,
		};
	}

	test("leaves out a session of this machine whose pid now belongs to another process", () => {
		writePresence(entry("open", { start: "100", startedAt: 2 }), root);
		writePresence(entry("crashed", { start: "90", startedAt: 1 }), root);
		const lives = (_pid: number, start: string | undefined) => start === "100";
		expect(readPresence(lives, "laptop", root).map((open) => open.session)).toEqual(["open"]);
	});

	test("keeps another machine's sessions, which only their machine can judge", () => {
		writePresence(entry("far", { host: "server", start: "90" }), root);
		expect(readPresence(() => false, "laptop", root).map((open) => open.session)).toEqual(["far"]);
	});

	test("orders by when the session opened, and forgets a removed one", () => {
		writePresence(entry("late", { startedAt: 5 }), root);
		writePresence(entry("early", { startedAt: 3 }), root);
		expect(readPresence(() => true, "laptop", root).map((open) => open.session)).toEqual([
			"early",
			"late",
		]);
		removePresence("early", root);
		expect(readPresence(() => true, "laptop", root).map((open) => open.session)).toEqual(["late"]);
	});

	test("an empty or missing index reads as nobody", () => {
		expect(readPresence(() => true, "laptop", join(root, "nowhere"))).toEqual([]);
	});
});
