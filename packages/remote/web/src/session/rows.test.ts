// The list draws what the daemon listed, and orders it by who is waiting. No server, no socket: the
// rows are the only input, so a test says what the screen does rather than what the network did.
import { describe, expect, test } from "bun:test";

import type { ListedSession } from "@adeildo/pi-remote-protocol/client";

import { keyOf, nameOf, rowsOf } from "./rows.ts";

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

	test("a row carries the name, where it runs and how it is doing", () => {
		const rows = draw([
			row({
				summary: {
					session: "s1",
					machine: "here",
					cwd: "/w",
					kind: "terminal",
					name: "the rig",
					status: "working",
				} as never,
			}),
		]);
		expect(rows[0]).toMatchObject({ name: "the rig", where: "here", doing: "working" });
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
		expect(rows[0]?.waits).toBe(true);
		expect(rows[1]?.waits).toBe(false);
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
		expect(held[1]?.waits).toBe(true);

		expect(rowsOf([blocked, other])[0]?.session).toBe("aaaa");
	});
});
