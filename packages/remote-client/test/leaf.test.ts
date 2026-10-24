// Where the branch ends is the bridge's word, not the client's guess. A `/tree` move, including the
// one back to the root, has to change what the screen draws, and the client has to keep the word for
// the next visit instead of recomputing it from the last entry it happens to hold.
import { describe, expect, test } from "bun:test";

import { emptySessionState } from "@adeildo/pi-remote-protocol";

import { memoryCache } from "../src/cache.ts";
import { Outbox } from "../src/outbox.ts";
import { readEnvelope, sessionOf, cachedOf, transcriptOfSession } from "../src/session.ts";

const key = { machine: "here", session: "s" };

const entry = (id: string, parentId: string | null, text: string): unknown => ({
	id,
	parentId,
	type: "message",
	timestamp: "2026-10-24T00:00:00.000Z",
	message: { role: "user", content: [{ type: "text", text }] },
});

const envelope = (type: string, data: unknown, at: number): unknown => ({
	v: 1,
	kind: "event",
	machine: "here",
	session: "s",
	epoch: "e1",
	seq: at,
	type,
	data,
	at: 0,
});

/** A client that already read the first envelope of an epoch, so the next one is in order. */
function started() {
	return sessionOf(key, {
		key,
		cursor: { epoch: "e1", seq: 1 },
		entries: [],
		state: emptySessionState(),
	});
}

describe("the leaf the bridge names", () => {
	test("a move back in the tree draws the branch from there, not from the last entry held", () => {
		const session = started();
		readEnvelope(session, envelope("entry", entry("a", null, "first"), 2));
		readEnvelope(session, envelope("entry", entry("b", "a", "second"), 3));
		readEnvelope(session, envelope("entry", entry("c", "b", "third"), 4));
		expect(transcriptOfSession(session).items).toHaveLength(3);

		readEnvelope(session, envelope("leaf.changed", { leaf: "b" }, 5));
		expect(transcriptOfSession(session).items).toHaveLength(2);
		expect(session.cursor.entry).toBe("b");
	});

	test("a leaf back at the root draws nothing, because nothing comes before the root", () => {
		const session = started();
		readEnvelope(session, envelope("entry", entry("a", null, "first"), 2));
		readEnvelope(session, envelope("leaf.changed", { leaf: null }, 3));
		expect(transcriptOfSession(session).items).toEqual([]);
		expect(session.cursor.entry).toBeUndefined();
	});

	test("a leaf the client never read asks for a snapshot, and keeps what it had", () => {
		const session = started();
		readEnvelope(session, envelope("entry", entry("a", null, "first"), 2));
		readEnvelope(session, envelope("entry", entry("b", "a", "second"), 3));

		// A sibling branch, or one older than the snapshot: only a snapshot can put it back.
		const answer = readEnvelope(session, envelope("leaf.changed", { leaf: "c" }, 4));
		expect(answer).toEqual({ read: "snapshot", why: "gap" });
		expect(transcriptOfSession(session).items).toHaveLength(2);
		expect(session.cursor.entry).toBe("b");
	});

	test("a snapshot that names its leaf is read from that leaf, not from its last entry", () => {
		const session = sessionOf(key, {
			key,
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			state: emptySessionState(),
		});
		readEnvelope(
			session,
			envelope(
				"snapshot",
				{
					snapshot: { session: "s", machine: "here", cwd: "/work", kind: "terminal", leaf: "a" },
					entries: [entry("a", null, "first"), entry("b", "a", "second")],
					state: emptySessionState(),
				},
				2,
			),
		);
		expect(session.leaf).toBe("a");
		expect(transcriptOfSession(session).items).toHaveLength(1);
	});

	test("the leaf travels with the cache, so a warm open draws the same branch", async () => {
		const session = started();
		readEnvelope(session, envelope("entry", entry("a", null, "first"), 2));
		readEnvelope(session, envelope("entry", entry("b", "a", "second"), 3));
		readEnvelope(session, envelope("leaf.changed", { leaf: "a" }, 4));

		const cache = memoryCache();
		await cache.write(cachedOf(session, new Outbox()));
		const warm = sessionOf(key, await cache.read(key));
		expect(transcriptOfSession(warm).items).toHaveLength(1);
	});
});
