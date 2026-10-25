// The room a session opens in, with a real pi: the setting belongs to the session that opens, so two
// sessions in the same folder can start in different modes and each says so for itself. A rig holds
// one session at a time — the log's folder is process-wide — so the runs are one after the other,
// over the same folder, and what survives is what the log carries.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eventsDir } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";

import peers from "../src/index.ts";

// Three real pi sessions over one folder: each one loads the extensions, so the file gets the room.
setDefaultTimeout(20_000);

let root = "";
let rig: Rig | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-rooms-rig-"));
});

afterEach(() => {
	rig?.dispose();
	rig = undefined;
	rmSync(root, { recursive: true, force: true });
});

const cwd = (): string => join(root, "work");

/** Every line the folder's log holds, whoever wrote it. */
function logged(): { type: string; data: Record<string, unknown> }[] {
	// The rig puts the log under its own root, so the default folder is not where it wrote.
	const dir = eventsDir(cwd(), join(root, "events"));
	const files: string[] = [];
	const walk = (path: string): void => {
		for (const name of readdirSync(path)) {
			const child = join(path, name);
			if (statSync(child).isDirectory()) walk(child);
			else if (name.endsWith(".jsonl")) files.push(child);
		}
	};
	walk(dir);
	return files.flatMap((file) =>
		readFileSync(file, "utf8")
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> }),
	);
}

/** Opens a session in the folder, in the mode its own setting names, and ends it. */
async function session(opening: "in" | "listening"): Promise<string> {
	rig = await createRig({
		root,
		cwd: cwd(),
		extensions: [peers],
		settings: { peers: { opening } },
	});
	await rig.prompt("hello");
	const id = rig.session.sessionId;
	rig.dispose();
	rig = undefined;
	return id;
}

test("each session opens in the mode its own setting names, and only one says so", async () => {
	const quiet = await session("listening");
	// A session that takes part says nothing: taking part is what the room assumes.
	const loud = await session("in");
	const other = await session("listening");

	// The log is read file by file, so the two lines come in whatever order the session files have.
	const modes = logged()
		.filter((line) => line.type === "room.mode")
		.map((line) => line.data);
	expect(modes).toHaveLength(2);
	expect(modes.every((data) => data.mode === "listening")).toBe(true);
	expect(modes.map((data) => (data.member as { session: string }).session).toSorted()).toEqual(
		[quiet, other].toSorted(),
	);
	// The one that takes part wrote no mode at all: taking part is what the room assumes.
	expect(modes.some((data) => (data.member as { session: string }).session === loud)).toBe(false);
	// The three opened in the same folder and the log kept all three, which is what makes the mode of
	// one of them readable by the others.
	const started = logged().filter((line) => line.type === "session.started");
	expect(started).toHaveLength(3);
	expect(logged().some((line) => line.type === "room.mode" && line.data.member !== undefined)).toBe(
		true,
	);
	expect(loud).not.toBe(quiet);
});

test("a session that opens again in the same mode does not write the line again", async () => {
	const quiet = await session("listening");
	const again = await session("listening");
	// Two sessions, two lines: the fold is per session, and a new session is not a repeat of the old
	// one even in the same folder.
	expect(logged().filter((line) => line.type === "room.mode")).toHaveLength(2);
	expect(quiet).not.toBe(again);
});
