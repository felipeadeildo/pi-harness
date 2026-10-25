import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RoomFeeds } from "../src/feeds.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A rooms folder with the given room ids, each holding one header line its folder can read. */
function disk(...ids: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "rooms-"));
	roots.push(root);
	for (const id of ids) {
		mkdirSync(join(root, "rooms", id), { recursive: true });
		writeFileSync(join(root, "rooms", id, "log.jsonl"), "");
	}
	return root;
}

describe("the rooms on disk", () => {
	test("a scan finds every room the folder names, and reading one folds what it holds", () => {
		const root = disk("a", "b");
		const feeds = new RoomFeeds(() => {});
		feeds.scan(root);
		const found = [...feeds.values()].map((room) => room.id).toSorted();
		expect(found).toEqual(["a", "b"]);
		const [first] = [...feeds.values()];
		expect(() => feeds.read(first!)).not.toThrow();
		feeds.stop();
	});

	test("a second scan adds nothing for a room it already holds", () => {
		const root = disk("a");
		const feeds = new RoomFeeds(() => {});
		feeds.scan(root);
		const before = [...feeds.values()][0];
		feeds.scan(root);
		expect([...feeds.values()]).toHaveLength(1);
		expect([...feeds.values()][0]).toBe(before!);
		feeds.stop();
	});

	test("a room closed once is done, and stopping the feeds empties them", () => {
		const feeds = new RoomFeeds(() => {});
		feeds.scan(disk("a", "b"));
		const [first, second] = [...feeds.values()];
		feeds.close(first!);
		expect(first!.done).toBe(true);
		expect(second!.done).toBeUndefined();
		feeds.stop();
		expect([...feeds.values()]).toEqual([]);
	});

	test("a folder that is not there is no room at all, and scanning says so quietly", () => {
		const feeds = new RoomFeeds(() => {});
		expect(() => feeds.scan(join(tmpdir(), "no-such-rooms-here"))).not.toThrow();
		expect([...feeds.values()]).toEqual([]);
	});
});
