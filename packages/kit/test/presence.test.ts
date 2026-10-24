import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ownStart,
	type PresenceEntry,
	processLives,
	processStart,
	readPresence,
	removePresence,
	startFromStat,
	startsFromPs,
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

	test("a zombie has exited, so it has no start to compare", () => {
		const fields = Array.from({ length: 50 }, (_, index) => String(index + 3));
		fields[0] = "Z";
		expect(startFromStat(`4242 (pi) ${fields.join(" ")}`)).toBeUndefined();
	});

	test("reads the same for a running process every time, and nothing for a pid nobody holds", () => {
		if (process.platform !== "linux" && process.platform !== "darwin") return;
		const start = processStart(process.pid);
		expect(start).toBeString();
		expect(processStart(process.pid)).toBe(start);
		expect(ownStart()).toBe(start);
		expect(processStart(GONE)).toBeUndefined();
	});

	test("on macOS, one listing of ps gives every pid its start", () => {
		const listing = "    1 Thu Oct 23 09:01:02 2026\n  4242 Fri Oct 24 10:11:12 2026\n\n";
		expect(startsFromPs(listing)).toEqual(
			new Map([
				[1, "Thu Oct 23 09:01:02 2026"],
				[4242, "Fri Oct 24 10:11:12 2026"],
			]),
		);
	});
});

describe("whether the process that wrote an entry runs", () => {
	test("a pid that runs with the start it recorded is the same process", () => {
		expect(processLives(4242, "100", () => "100")).toBe(true);
	});

	test("a pid the system gave to a later process is not, and neither is a pid that is gone", () => {
		expect(processLives(4242, "100", () => "250")).toBe(false);
		const onlyThisOne = (pid: number) => (pid === process.pid ? "1" : undefined);
		expect(processLives(4242, "100", onlyThisOne)).toBe(false);
	});

	test("a reader on a system that reports no starts judges by the pid alone", () => {
		expect(processLives(process.pid, "100", () => undefined)).toBe(true);
		expect(processLives(GONE, "100", () => undefined)).toBe(false);
	});

	test("another user's process counts as running, though it cannot be signalled", () => {
		// pid 1 belongs to the system, so signalling it answers EPERM unless the test runs as root.
		if (process.getuid?.() === 0) return;
		expect(processLives(1, undefined)).toBe(true);
	});

	test("a pid that names no single process never runs, whatever the start", () => {
		for (const pid of [0, -1, 1.5, Number.NaN]) {
			expect(processLives(pid, undefined)).toBe(false);
			expect(processLives(pid, "100", () => "100")).toBe(false);
		}
	});

	test("an entry with no start, written before starts were recorded, is judged by its pid", () => {
		expect(processLives(process.pid, undefined)).toBe(true);
		expect(processLives(GONE, undefined)).toBe(false);
	});
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

function startsAt100(_pid: number, start: string | undefined): boolean {
	return start === "100";
}

describe("the index of open sessions", () => {
	let root = "";
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "presence-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("leaves out a session of this machine whose pid now belongs to another process", () => {
		writePresence(entry("open", { start: "100", startedAt: 2 }), root);
		writePresence(entry("crashed", { start: "90", startedAt: 1 }), root);
		expect(
			readPresence({ lives: startsAt100, host: "laptop", root }).map((open) => open.session),
		).toEqual(["open"]);
	});

	test("keeps another machine's sessions, which only their machine can judge", () => {
		writePresence(entry("far", { host: "server", start: "90" }), root);
		expect(
			readPresence({ lives: () => false, host: "laptop", root }).map((open) => open.session),
		).toEqual(["far"]);
	});

	test("orders by when the session opened, and forgets a removed one", () => {
		writePresence(entry("late", { startedAt: 5 }), root);
		writePresence(entry("early", { startedAt: 3 }), root);
		expect(
			readPresence({ lives: () => true, host: "laptop", root }).map((open) => open.session),
		).toEqual(["early", "late"]);
		removePresence("early", root);
		expect(
			readPresence({ lives: () => true, host: "laptop", root }).map((open) => open.session),
		).toEqual(["late"]);
	});

	test("an empty or missing index reads as nobody", () => {
		expect(
			readPresence({ lives: () => true, host: "laptop", root: join(root, "nowhere") }),
		).toEqual([]);
	});

	test("a write leaves only the entry, and a failed one leaves nothing and throws nothing", () => {
		writePresence(entry("open"), root);
		expect(readdirSync(join(root, "live"))).toEqual(["open.json"]);
		const file = join(root, "not-a-folder");
		writeFileSync(file, "");
		expect(() => writePresence(entry("lost"), file)).not.toThrow();
		expect(() => removePresence("lost", file)).not.toThrow();
	});

	test("a write replaces the entry's file, which is what keeps a reader from half of it", () => {
		writePresence(entry("open"), root);
		const before = statSync(join(root, "live", "open.json")).ino;
		writePresence(entry("open", { at: 2 }), root);
		expect(statSync(join(root, "live", "open.json")).ino).not.toBe(before);
	});

	test("a write that cannot take the entry's place leaves no temporary file behind", () => {
		mkdirSync(join(root, "live", "blocked.json"), { recursive: true });
		expect(() => writePresence(entry("blocked"), root)).not.toThrow();
		expect(readdirSync(join(root, "live"))).toEqual(["blocked.json"]);
	});

	test("a temporary file a crashed write left behind is not an entry", () => {
		mkdirSync(join(root, "live"), { recursive: true });
		writeFileSync(join(root, "live", "open.json.99.tmp"), JSON.stringify(entry("open")));
		expect(readPresence({ lives: () => true, host: "laptop", root })).toEqual([]);
	});

	test("an entry whose fields are the wrong kind is skipped", () => {
		writePresence(entry("good"), root);
		writePresence({ ...entry("bad"), file: 7 } as unknown as PresenceEntry, root);
		writePresence({ ...entry("stateless"), state: undefined } as unknown as PresenceEntry, root);
		writePresence({ ...entry("timeless"), at: "now" } as unknown as PresenceEntry, root);
		expect(
			readPresence({ lives: () => true, host: "laptop", root }).map((open) => open.session),
		).toEqual(["good"]);
	});
});
