// Presence is of the moment: it is applied as it arrives and never reduced from a replay, because a
// client that reconnects would otherwise draw who was watching ten minutes ago.
import { describe, expect, test } from "bun:test";

import { emptySessionState, isStateChangeType, STATE_CHANGES } from "@adeildo/pi-remote-protocol";

import { memoryCache } from "../../src/client/cache.ts";
import { Outbox } from "../../src/client/outbox.ts";
import { type ClientSession, cachedOf, readEnvelope, sessionOf } from "../../src/client/session.ts";

const key = { machine: "here", session: "s" };

const envelope = (type: string, data: unknown, seq: number): unknown => ({
	v: 1,
	kind: "event",
	machine: "here",
	session: "s",
	epoch: "e1",
	seq,
	type,
	data,
	at: 0,
});

const started = () =>
	sessionOf(key, {
		key,
		cursor: { epoch: "e1", seq: 1 },
		entries: [],
		state: emptySessionState(),
	});

/** Reads an envelope and keeps the session it returned: reading never mutates the one it was given. */
function read(session: ClientSession, value: unknown): ClientSession {
	const answer = readEnvelope(session, value);
	return answer.read === "now" ? answer.session : session;
}

describe("who has the session open", () => {
	test("the event is applied, and the cursor moves with it", () => {
		let session = started();
		session = read(
			session,
			envelope(
				"presence.changed",
				{
					viewers: [{ name: "phone", machine: "here" }],
					active: { kind: "client", name: "phone", machine: "here" },
				},
				2,
			),
		);

		expect(session.presence?.viewers).toHaveLength(1);
		expect(session.presence?.active?.kind).toBe("client");
		expect(session.cursor.seq).toBe(2);
	});

	test("a presence that does not decode is skipped instead of drawn half way", () => {
		const session = started();
		expect(readEnvelope(session, envelope("presence.changed", { viewers: "phone" }, 2)).read).toBe(
			"skip",
		);
		expect(session.presence).toBeUndefined();
	});

	test("presence never becomes a fact, because the log has no shelf life", () => {
		// The difference between "the client applies it" and "the log remembers it": a fact is
		// replayed, and a replay would say who was watching an hour ago.
		const presence = { viewers: [{ name: "phone", machine: "here" }] };
		expect(STATE_CHANGES).not.toContain("presence.changed" as never);
		expect(isStateChangeType("presence.changed")).toBe(false);
		expect(presence.viewers).toHaveLength(1);
	});

	test("an opening may carry it, so the first draw is who is watching now", () => {
		let session = sessionOf(key, {
			key,
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			state: emptySessionState(),
		});
		session = read(session, {
			v: 1,
			kind: "event",
			machine: "here",
			session: "s",
			epoch: "e1",
			seq: 2,
			type: "state",
			data: {
				summary: {
					session: "s",
					machine: "here",
					cwd: "/w",
					kind: "terminal",
					viewers: [{ name: "laptop", machine: "here" }],
				},
				entries: [],
			},
			at: 0,
		});
		expect(session.presence?.viewers[0]?.name).toBe("laptop");
	});

	test("the last presence travels with the cache, so a warm open draws who was there", async () => {
		let session = started();
		session = read(
			session,
			envelope("presence.changed", { viewers: [{ name: "phone", machine: "here" }] }, 2),
		);
		const cache = memoryCache();
		await cache.write(cachedOf(session, new Outbox()));
		const warm = sessionOf(key, await cache.read(key));
		expect(warm.presence?.viewers[0]?.name).toBe("phone");
	});

	test("the cache keeps who was watching and not who was typing", async () => {
		// `active` says someone is typing now, and a cache can be days old: it comes back from the
		// opening or the next event, never from a file.
		let session = started();
		session = read(
			session,
			envelope(
				"presence.changed",
				{
					viewers: [{ name: "phone", machine: "here" }],
					active: { kind: "client", name: "phone", machine: "here" },
				},
				2,
			),
		);
		expect(session.presence?.active?.name).toBe("phone");
		const cache = memoryCache();
		await cache.write(cachedOf(session, new Outbox()));
		const warm = sessionOf(key, await cache.read(key));
		expect(warm.presence).toEqual({ viewers: [{ name: "phone", machine: "here" }] });
	});

	test("a cache written by an older client keeps the names and drops the claim about typing", () => {
		// A file from before this rule carries `active` with whatever age the file has, so the read
		// cuts it too; cutting only on write would leave every existing cache wrong for ever.
		const older = {
			key,
			cursor: {},
			entries: [],
			state: emptySessionState(),
			presence: {
				viewers: [{ name: "phone", machine: "here" }],
				active: { kind: "client", name: "phone", machine: "here" },
			},
		};
		expect(sessionOf(key, older as never).presence).toEqual({
			viewers: [{ name: "phone", machine: "here" }],
		});
	});
});
