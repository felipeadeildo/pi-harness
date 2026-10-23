import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileTail, followFile, type TailItem } from "../src/sources/follow.ts";

function file(): string {
	return join(mkdtempSync(join(tmpdir(), "follow-")), "session.jsonl");
}

function line(id: string, extra: Record<string, unknown> = {}): string {
	return `${JSON.stringify({ id, ...extra })}\n`;
}

function ids(items: TailItem[]): string[] {
	return items.map((item) => (item.kind === "reset" ? "reset" : item.record.id));
}

describe("a file followed as it grows", () => {
	test("hands over each record once, as the file gains it", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b"));
		const tail = new FileTail(path);
		expect(ids(tail.poll())).toEqual(["a", "b"]);
		expect(ids(tail.poll())).toEqual([]);
		appendFileSync(path, line("c"));
		expect(ids(tail.poll())).toEqual(["c"]);
	});

	test("waits for the end of a line before reading it", () => {
		const path = file();
		writeFileSync(path, line("a") + '{"id":"b"');
		const tail = new FileTail(path);
		expect(ids(tail.poll())).toEqual(["a"]);
		appendFileSync(path, ',"x":1}\n');
		expect(ids(tail.poll())).toEqual(["b"]);
	});

	test("waits for a file that does not exist yet", () => {
		const path = file();
		const tail = new FileTail(path);
		expect(tail.poll()).toEqual([]);
		writeFileSync(path, line("a"));
		expect(ids(tail.poll())).toEqual(["a"]);
	});

	test("skips lines that are not records with an id", () => {
		const path = file();
		writeFileSync(path, `${line("a")}not json\n{"no":"id"}\n[1]\n\n${line("b")}`);
		expect(ids(new FileTail(path).poll())).toEqual(["a", "b"]);
	});

	test("resumes from a kept state without reading the start again", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b"));
		const first = new FileTail(path);
		first.poll();
		appendFileSync(path, line("c"));
		expect(ids(new FileTail(path, first.state).poll())).toEqual(["c"]);
	});
});

describe("a rewritten file", () => {
	test("is read again from the start with no record twice", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b"));
		const tail = new FileTail(path);
		tail.poll();
		// Pi migrating a file rewrites every line, longer, with the same ids, and may append after.
		writeFileSync(path, line("a", { v: 3 }) + line("b", { v: 3 }) + line("c", { v: 3 }));
		expect(ids(tail.poll())).toEqual(["c"]);
	});

	test("that shrank is read again", () => {
		const path = file();
		writeFileSync(path, line("a", { pad: "x".repeat(200) }) + line("b"));
		const tail = new FileTail(path);
		tail.poll();
		writeFileSync(path, line("a") + line("b"));
		expect(ids(tail.poll())).toEqual([]);
		appendFileSync(path, line("c"));
		expect(ids(tail.poll())).toEqual(["c"]);
	});

	test("under a new inode is read again", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b"));
		const tail = new FileTail(path);
		tail.poll();
		const next = `${path}.new`;
		writeFileSync(next, line("a") + line("b") + line("c"));
		renameSync(next, path);
		expect(ids(tail.poll())).toEqual(["c"]);
	});

	test("without the last record read starts over, saying so", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b"));
		const tail = new FileTail(path);
		tail.poll();
		writeFileSync(path, line("x") + line("y") + line("z"));
		expect(ids(tail.poll())).toEqual(["reset", "x", "y", "z"]);
	});

	test("to the same size is read again", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b"));
		// The first write is long past, so the rewrite's modification time differs on any filesystem.
		utimesSync(path, 1, 1);
		const tail = new FileTail(path);
		tail.poll();
		writeFileSync(path, line("x") + line("y"));
		expect(ids(tail.poll())).toEqual(["reset", "x", "y"]);
	});

	test("finds the line before its offset however long that line is", () => {
		const path = file();
		writeFileSync(path, line("a") + line("b", { pad: "x".repeat(20_000) }));
		const tail = new FileTail(path);
		tail.poll();
		appendFileSync(path, line("c"));
		expect(ids(tail.poll())).toEqual(["c"]);
	});
});

describe("following a file", () => {
	test("calls back as the file appears and grows, and stops when asked", async () => {
		const path = file();
		const seen: string[] = [];
		const stop = followFile(path, (items) => seen.push(...ids(items)), { every: 5 });
		writeFileSync(path, line("a"));
		await until(() => seen.length === 1);
		appendFileSync(path, line("b"));
		await until(() => seen.length === 2);
		stop();
		appendFileSync(path, line("c"));
		await Bun.sleep(30);
		expect(seen).toEqual(["a", "b"]);
	});
});

async function until(done: () => boolean, tries = 200): Promise<void> {
	if (done() || tries === 0) return expect(done()).toBe(true);
	await Bun.sleep(5);
	return until(done, tries - 1);
}
