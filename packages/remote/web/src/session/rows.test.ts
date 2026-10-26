// The list draws what the daemon listed, and orders it by who is waiting. No server, no socket: the
// rows are the only input, so a test says what the screen does rather than what the network did.
import { describe, expect, test } from "bun:test";

import type { ListedSession } from "@adeildo/pi-remote-protocol/client";

import { countOf, groupsOf, keyOf, matchRows, nameOf, rowsOf } from "./rows.ts";

const live = { pid: 1, startedAt: 1, cwd: "/work", kind: "terminal" as const };

const row = (over: Partial<ListedSession> = {}): ListedSession =>
	({
		machine: "here",
		session: "s1",
		epoch: "e1",
		connected: true,
		live,
		state: { questions: {}, permissions: { rulings: {} } },
		...over,
	}) as ListedSession;

/** The list as the page draws it: the data a test can read without a browser. */
const draw = (sessions: ListedSession[]) => rowsOf(sessions);

describe("the list of sessions", () => {
	test("an empty list is empty, and the screen says so instead of leaving a blank page", () => {
		expect(draw([])).toEqual([]);
	});

	test("a row carries the name, its folder, how it is doing and with what", () => {
		const rows = draw([
			row({
				summary: {
					session: "s1",
					machine: "here",
					cwd: "/home/me/Projects/pi-harness/",
					kind: "terminal",
					name: "the rig",
					status: "working",
				} as never,
				state: {
					questions: {},
					permissions: { rulings: {} },
					queue: [],
					model: { provider: "anthropic", id: "claude-opus" },
					theme: { accent: "accent", color: "syntaxKeyword" },
				},
			}),
		]);
		expect(rows[0]).toMatchObject({
			name: "the rig",
			folder: "pi-harness",
			path: "~/Projects/pi-harness",
			word: "working",
			model: "claude-opus",
			mark: "working",
			color: "syntaxKeyword",
		});
	});

	test("a session that has not said how it is doing reads as idle, with no color it was not given", () => {
		const [quiet] = draw([row()]);
		expect(quiet?.word).toBe("idle");
		expect(quiet?.mark).toBe("idle");
		expect(Object.keys(quiet ?? {})).not.toContain("color");
	});

	test("the rows sit under what they need, and the line over them counts what waits on you", () => {
		const rows = draw([
			row({ machine: "laptop", session: "a" }),
			row({ machine: "vps", session: "b", summary: { status: "blocked" } as never }),
			row({ machine: "laptop", session: "c", state: { ...row().state, status: "working" } }),
			row({ machine: "laptop", session: "d", gone: "exit" }),
		]);
		expect(groupsOf(rows).map((group) => [group.id, group.rows.map((one) => one.session)])).toEqual(
			[
				["you", ["b"]],
				["working", ["c"]],
				["idle", ["a"]],
				["closed", ["d"]],
			],
		);
		expect(countOf(rows)).toBe("3 open on 2 machines, 1 needs you");
		expect(countOf(rows.filter((one) => one.machine === "laptop"))).toBe("2 open");
	});

	test("the name is the title, then the handle, then the name the bridge gave it", () => {
		expect(nameOf(row({ summary: { name: "the rig", handle: "rig" } as never }))).toBe("the rig");
		expect(nameOf(row({ summary: { handle: "rig" } as never }))).toBe("rig");
		expect(nameOf(row({ live: { ...live, name: "from the bridge" } }))).toBe("from the bridge");
		expect(nameOf(row({ session: "01a16b0a-8f6e-7249-9571-b11736957af9" }))).toBe("new-7af9");
	});

	test("a row that waits is marked, and the ones that wait come first", () => {
		const rows = draw([
			row({ session: "quiet", summary: { status: "idle" } as never }),
			row({ session: "asking", summary: { status: "blocked" } as never }),
		]);
		expect(rows[0]?.session).toBe("asking");
		expect(rows[0]).toMatchObject({ mark: "waits", word: "waits on you" });
		expect(rows[1]).toMatchObject({ mark: "idle", word: "idle" });
	});

	test("a kept order holds its places when one of them starts waiting, and a fresh list sorts", () => {
		const calm = row({ machine: "box", session: "aaaa", summary: { status: "working" } as never });
		const other = row({
			machine: "box",
			session: "bbbb",
			summary: { status: "working" } as never,
		});
		const kept = [keyOf(other), keyOf(calm)];

		// The same session now waits on the person: with the kept order it stays second and the mark
		// changes; a list drawn for the first time puts it first, which is what the person expects.
		const blocked = row({
			machine: "box",
			session: "aaaa",
			summary: { status: "blocked" } as never,
		});
		const held = rowsOf([blocked, other], kept);
		expect(held.map((one) => one.session)).toEqual(["bbbb", "aaaa"]);
		expect(held[1]?.mark).toBe("waits");

		expect(rowsOf([blocked, other])[0]?.session).toBe("aaaa");
	});

	test("what the agent does, where, and what it last said travel to the row", () => {
		const [one] = draw([
			row({
				summary: {
					cwd: "/Users/me/work/api",
					context: { tokens: 250_000, window: 1_000_000 },
				} as never,
				state: {
					...row().state,
					status: "working",
					branch: "feat/x",
					activity: { what: "tool", tool: "bash", about: "bun test", since: 5 },
					said: { text: "All green.", at: 9 },
					cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 1.5 },
				},
			}),
		]);
		expect(one).toMatchObject({
			path: "~/work/api",
			branch: "feat/x",
			context: 0.25,
			cost: "$1.50",
			activity: { tool: "bash", about: "bun test" },
			said: "All green.",
			at: 9,
		});
	});

	test("a search keeps the rows whose name, folder or branch has every word", () => {
		const rows = draw([
			row({ session: "a", summary: { handle: "kestrel", cwd: "/home/me/hedy" } as never }),
			row({ session: "b", summary: { handle: "locust", cwd: "/home/me/pi-harness" } as never }),
		]);
		expect(matchRows(rows, "HEDY").map((one) => one.session)).toEqual(["a"]);
		expect(matchRows(rows, "locust pi").map((one) => one.session)).toEqual(["b"]);
		expect(matchRows(rows, "  ")).toHaveLength(2);
	});
});

describe("grouped by folder", () => {
	test("each folder is a group with who needs you first, and closed sessions fold at the end", () => {
		const at = (session: string, cwd: string, status?: string, gone?: string): ListedSession =>
			row({
				session,
				live: { ...live, cwd },
				...(status === undefined
					? {}
					: { summary: { session, machine: "here", cwd, kind: "terminal", status } as never }),
				...(gone === undefined ? {} : { gone: gone as never }),
			});
		const groups = groupsOf(
			rowsOf([
				at("a", "/work/hedy", "idle"),
				at("b", "/work/pi", "working"),
				at("c", "/work/hedy", "blocked"),
				at("d", "/work/pi", undefined, "exit"),
			]),
			"folder",
		);
		expect(groups.map((group) => [group.title, group.rows.map((one) => one.session)])).toEqual([
			["hedy", ["c", "a"]],
			["pi", ["b"]],
			["Closed", ["d"]],
		]);
		expect(groups.at(-1)?.closed).toBe(true);
		expect(groups[0]?.path).toBe("/work/hedy");
	});
});
