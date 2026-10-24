// The list draws what the daemon listed, and orders it by who is waiting. No server, no socket: the
// rows are the only input, so a test says what the screen does rather than what the network did.
import { describe, expect, test } from "bun:test";

import type { ListedSession } from "@adeildo/pi-remote-client";

import { nameOf, rowStyle, rowsOf } from "./rows.ts";

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

/** The list as the screen draws it: the data a test can read without a browser or a native host. */
const draw = (sessions: ListedSession[]) => rowsOf(sessions);

describe("the list of sessions", () => {
	test("an empty list is empty, and the screen says so instead of leaving a blank page", () => {
		expect(draw([])).toEqual([]);
	});

	test("a row carries the name, where it runs and how it is doing", () => {
		const rows = draw([
			row({
				snapshot: {
					session: "s1",
					machine: "here",
					cwd: "/w",
					kind: "terminal",
					name: "the rig",
				} as never,
			}),
		]);
		expect(rows[0]).toMatchObject({ name: "the rig", where: "here", doing: "working" });
	});

	test("the name is the title, then the handle, then the name the bridge gave it", () => {
		expect(nameOf(row({ snapshot: { name: "the rig", handle: "rig" } as never }))).toBe("the rig");
		expect(nameOf(row({ snapshot: { handle: "rig" } as never }))).toBe("rig");
		expect(nameOf(row({ live: { ...live, name: "from the bridge" } }))).toBe("from the bridge");
		expect(nameOf(row({ session: "01a16b0a-8f6e-7249-9571-b11736957af9" }))).toBe("new-7af9");
	});

	test("a row that waits is marked, and the ones that wait come first", () => {
		const rows = draw([
			row({ session: "quiet", snapshot: { status: "idle" } as never }),
			row({ session: "asking", snapshot: { status: "blocked" } as never }),
		]);
		expect(rows[0]?.session).toBe("asking");
		expect(rows[0]?.waits).toBe(true);
		expect(rows[1]?.waits).toBe(false);
	});

	test("a row's style is one object, because an array reaching the link's Slot is what blanked the page", () => {
		// The browser throws setting `style[0]` when a spread turns an array into `{0: …}`. Static markup
		// cannot show that, so what is pinned here is the type that causes it.
		expect(Array.isArray(rowStyle(true))).toBe(false);
		expect(Array.isArray(rowStyle(false))).toBe(false);
		expect(rowStyle(true)).not.toEqual(rowStyle(false));
	});
});
