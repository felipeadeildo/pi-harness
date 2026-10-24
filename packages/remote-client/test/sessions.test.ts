// The daemon's list, as a client reads it: one request and a row per session, with a broken row
// dropped instead of drawn half way.
import { describe, expect, test } from "bun:test";

import { listSessions } from "../src/sessions.ts";

const live = { pid: 42, startedAt: 1, cwd: "/work", name: "the rig", kind: "terminal" };
const facts = { tasks: undefined, rulings: {}, asks: {}, renamed: undefined };

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	machine: "here",
	session: "s1",
	epoch: "e1",
	connected: true,
	live,
	facts,
	...over,
});

const answering = (body: unknown, status = 200): typeof fetch =>
	(async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;

describe("the daemon's session list", () => {
	test("asks /sessions and reads a row per session", async () => {
		const asked: string[] = [];
		const speaks = (async (url: URL) => {
			asked.push(String(url));
			return new Response(JSON.stringify([row(), row({ session: "s2", connected: false })]), {
				status: 200,
			});
		}) as unknown as typeof fetch;

		const sessions = await listSessions("http://127.0.0.1:7878/", speaks);
		expect(asked).toEqual(["http://127.0.0.1:7878/sessions"]);
		expect(sessions.map((one) => one.session)).toEqual(["s1", "s2"]);
		expect(sessions[1]?.connected).toBe(false);
	});

	test("a row that does not decode is dropped, not drawn half way", async () => {
		const sessions = await listSessions(
			"http://127.0.0.1:7878",
			answering([row(), { session: "broken" }, row({ session: "s3", live: { pid: "42" } })]),
		);
		expect(sessions.map((one) => one.session)).toEqual(["s1"]);
	});

	test("a daemon that refuses is an error, not an empty list", async () => {
		await expect(listSessions("http://127.0.0.1:7878", answering({}, 401))).rejects.toThrow("401");
	});

	test("a body that is not a list is an error, not an empty list", async () => {
		await expect(
			listSessions("http://127.0.0.1:7878", answering({ sessions: [] })),
		).rejects.toThrow("not a list");
	});
});
