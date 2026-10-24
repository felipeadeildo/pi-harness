// Presence is of the moment: it is applied as it arrives and never reduced from a replay, because a
// client that reconnects would otherwise draw who was watching ten minutes ago.
import { describe, expect, test } from "bun:test";

import { memoryCache } from "../src/cache.ts";
import { cachedOf, readEnvelope, sessionOf } from "../src/session.ts";

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
	sessionOf(key, { key, cursor: { epoch: "e1", seq: 1 }, entries: [], facts: [] });

describe("who has the session open", () => {
	test("the event is applied, and the cursor moves with it", () => {
		const session = started();
		const answer = readEnvelope(
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
		expect(answer.read).toBe("now");
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

	test("the last presence travels with the cache, so a warm open draws who was there", async () => {
		const session = started();
		readEnvelope(
			session,
			envelope("presence.changed", { viewers: [{ name: "phone", machine: "here" }] }, 2),
		);
		const cache = memoryCache();
		await cache.write(cachedOf(session));
		const warm = sessionOf(key, await cache.read(key));
		expect(warm.presence?.viewers[0]?.name).toBe("phone");
	});
});
