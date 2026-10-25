// The daemon's list, as a client reads it: one request and a row per session, with a broken row
// dropped instead of drawn half way.
import { describe, expect, test } from "bun:test";

import {
	DaemonAnswer,
	inOrder,
	type ListedSession,
	listSessions,
	stateOf,
	wantsYou,
} from "../src/sessions.ts";

const live = { pid: 42, startedAt: 1, cwd: "/work", name: "the rig", kind: "terminal" };
const folded = {
	tasks: undefined,
	questions: {},
	permissions: { rulings: {} },
	renamed: undefined,
};

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	machine: "here",
	session: "s1",
	epoch: "e1",
	connected: true,
	live,
	state: folded,
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

	test("a list where nothing decodes is an error, not the same picture as no sessions", async () => {
		const unknown = [row({ session: undefined }), row({ live: undefined })];
		await expect(listSessions("http://127.0.0.1:7878", answering(unknown))).rejects.toThrow(
			"cannot read",
		);
	});

	test("the request can be given up on while it hangs", async () => {
		// A daemon that accepts the connection and never answers: only the signal ends the wait.
		const speaks = ((_url: URL, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			})) as unknown as typeof fetch;
		const abort = new AbortController();
		const pending = listSessions("http://127.0.0.1:7878", speaks, { signal: abort.signal });
		abort.abort();
		await expect(pending).rejects.toThrow("aborted");
	});

	test("a daemon that refuses is an error that carries the code", async () => {
		const refused = listSessions("http://127.0.0.1:7878", answering({}, 401));
		await expect(refused).rejects.toThrow("401");
		await refused.catch((error: unknown) => {
			expect(error).toBeInstanceOf(DaemonAnswer);
			expect((error as DaemonAnswer).status).toBe(401);
		});
	});

	test("each field the list needs is checked on its own", async () => {
		const broken: Record<string, unknown>[] = [
			row({ machine: 1 }),
			row({ session: 1 }),
			row({ epoch: 1 }),
			row({ connected: "yes" }),
			row({ live: { ...live, pid: "42" } }),
			row({ live: { ...live, startedAt: "1" } }),
			row({ live: { ...live, cwd: 1 } }),
			row({ live: { ...live, kind: "remote" } }),
			row({ state: "none" }),
			row({ state: {} }),
			row({ state: { permissions: { rulings: {} } } }),
			row({ state: { questions: {} } }),
			row({ snapshot: { session: "s1" } }),
		];
		const sessions = await listSessions("http://127.0.0.1:7878", answering([...broken, row()]));
		expect(sessions.map((one) => one.session)).toEqual(["s1"]);
	});

	test("a body that is not a list is an error, not an empty list", async () => {
		await expect(
			listSessions("http://127.0.0.1:7878", answering({ sessions: [] })),
		).rejects.toThrow("not a list");
	});
});

describe("how a listed session reads", () => {
	const listed = (over: Record<string, unknown> = {}): ListedSession =>
		({
			machine: "here",
			session: "s1",
			epoch: "e1",
			connected: true,
			live,
			state: { questions: {}, permissions: { rulings: {} } },
			...over,
		}) as unknown as ListedSession;

	test("the state says where it is, and reconnecting is newer than the last word", () => {
		expect(stateOf(listed())).toBe("working");
		expect(stateOf(listed({ connected: false }))).toBe("reconnecting");
		expect(stateOf(listed({ gone: "crash" }))).toBe("crash");
		expect(stateOf(listed({ live: { ...live, kind: "background" } }))).toBe("idle");
	});

	test("a question nobody answered is what makes a session wait on you", () => {
		const asking = {
			questions: { a: { id: "a", source: "ask-questions", questions: [] } },
			permissions: { rulings: {} },
		};
		expect(wantsYou(listed({ state: asking }))).toBe(true);
	});

	test("the permission mode is how a session behaves, not that it is stuck", () => {
		// `manual` says what happens when the agent edits; a session in it is not waiting on anybody.
		expect(wantsYou(listed({ snapshot: { status: "working" } }))).toBe(false);
		expect(wantsYou(listed({ snapshot: { status: "blocked" } }))).toBe(true);
	});

	test("the ones that need you come first, then the running ones, then what ended", () => {
		const asking = {
			questions: { a: { id: "a", source: "ask-questions", questions: [] } },
			permissions: { rulings: {} },
		};
		const order = inOrder([
			listed({ session: "ended", gone: "exit" }),
			listed({ session: "running" }),
			listed({ session: "waiting", state: asking }),
		]);
		expect(order.map((one) => one.session)).toEqual(["waiting", "running", "ended"]);
	});

	test("two sessions with the same title keep their order by identity, not by what came first", () => {
		const same = { name: "the rig" };
		const order = inOrder([
			listed({ machine: "b", session: "s2", snapshot: same }),
			listed({ machine: "a", session: "s1", snapshot: same }),
		]);
		expect(order.map((one) => one.machine)).toEqual(["a", "b"]);
	});
});
