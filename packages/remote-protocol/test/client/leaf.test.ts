// Where the branch ends is the bridge's word, not the client's guess. A `/tree` move, including the
// one back to the root, has to change what the screen draws, and the client has to keep the word for
// the next visit instead of recomputing it from the last entry it happens to hold.
import { describe, expect, test } from "bun:test";

import { emptySessionState } from "@adeildo/pi-remote-protocol";

import { memoryCache } from "../../src/client/cache.ts";
import { Outbox } from "../../src/client/outbox.ts";
import {
	type ClientSession,
	readEnvelope,
	sessionOf,
	cachedOf,
	transcriptOfSession,
} from "../../src/client/session.ts";

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

/** Reads an envelope and keeps the session it returned: reading never mutates the one it was given. */
function read(session: ClientSession, value: unknown): ClientSession {
	const answer = readEnvelope(session, value);
	return answer.read === "now" ? answer.session : session;
}

describe("the leaf the bridge names", () => {
	test("a move back in the tree draws the branch from there, not from the last entry held", () => {
		let session = started();
		session = read(session, envelope("entry", entry("a", null, "first"), 2));
		session = read(session, envelope("entry", entry("b", "a", "second"), 3));
		session = read(session, envelope("entry", entry("c", "b", "third"), 4));
		expect(transcriptOfSession(session).items).toHaveLength(3);

		session = read(session, envelope("leaf.changed", { leaf: "b" }, 5));
		expect(transcriptOfSession(session).items).toHaveLength(2);
		expect(session.cursor.entry).toBe("b");
	});

	test("a leaf back at the root draws nothing, because nothing comes before the root", () => {
		let session = started();
		session = read(session, envelope("entry", entry("a", null, "first"), 2));
		session = read(session, envelope("leaf.changed", { leaf: null }, 3));
		expect(transcriptOfSession(session).items).toEqual([]);
		expect(session.cursor.entry).toBeUndefined();
	});

	test("a leaf the client never read asks for a snapshot, and keeps what it had", () => {
		let session = started();
		session = read(session, envelope("entry", entry("a", null, "first"), 2));
		session = read(session, envelope("entry", entry("b", "a", "second"), 3));

		// A sibling branch, or one older than the state: only the whole state can put it back, and the
		// read says so while leaving the session exactly as it was.
		expect(readEnvelope(session, envelope("leaf.changed", { leaf: "c" }, 4))).toEqual({
			read: "state",
			why: "gap",
		});
		expect(transcriptOfSession(session).items).toHaveLength(2);
		expect(session.cursor.entry).toBe("b");
	});

	test("a snapshot that names its leaf is read from that leaf, not from its last entry", () => {
		let session = sessionOf(key, {
			key,
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			state: emptySessionState(),
		});
		session = read(
			session,
			envelope(
				"state",
				{
					summary: {
						session: "s",
						machine: "here",
						cwd: "/work",
						kind: "terminal",
						leaf: "a",
						state: emptySessionState(),
					},
					entries: [entry("a", null, "first"), entry("b", "a", "second")],
				},
				2,
			),
		);
		expect(session.leaf).toBe("a");
		expect(transcriptOfSession(session).items).toHaveLength(1);
	});

	test("the leaf travels with the cache, so a warm open draws the same branch", async () => {
		let session = started();
		session = read(session, envelope("entry", entry("a", null, "first"), 2));
		session = read(session, envelope("entry", entry("b", "a", "second"), 3));
		session = read(session, envelope("leaf.changed", { leaf: "a" }, 4));

		const cache = memoryCache();
		await cache.write(cachedOf(session, new Outbox()));
		const warm = sessionOf(key, await cache.read(key));
		expect(transcriptOfSession(warm).items).toHaveLength(1);
	});
});

test("a state envelope whose snapshot is not a snapshot is skipped, so half a swap never lands", () => {
	// The whole state is replaced at once. A `state` whose `snapshot` is a string would swap in an
	// object nobody checked, and the screen would draw it as if it were the session's truth.
	const session = sessionOf({ machine: "m", session: "s" });
	const before = session.state;
	const read = readEnvelope(
		session,
		envelope("state", { snapshot: "not a snapshot", entries: [] }, 1),
	);
	expect(read).toEqual({ read: "skip" });
	expect(session.state).toBe(before);
});
