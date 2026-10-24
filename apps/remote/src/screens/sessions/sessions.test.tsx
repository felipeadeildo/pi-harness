// The list draws what the daemon listed, and orders it by who is waiting. No server, no socket: the
// rows are the only input, so a test says what the screen does rather than what the network did.
import { describe, expect, test } from "bun:test";

import type { ListedSession } from "@adeildo/pi-remote-client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { nameOf, SessionsScreen } from "./sessions.tsx";

const live = { pid: 1, startedAt: 1, cwd: "/work", kind: "terminal" as const };

const row = (over: Partial<ListedSession> = {}): ListedSession =>
	({
		machine: "here",
		session: "s1",
		epoch: "e1",
		connected: true,
		live,
		facts: { rulings: {}, asks: {} },
		...over,
	}) as ListedSession;

const draw = (sessions: ListedSession[]): string =>
	renderToStaticMarkup(createElement(SessionsScreen, { sessions }));

describe("the list of sessions", () => {
	test("an empty list says so, instead of drawing nothing", () => {
		expect(draw([])).toContain("No session is open.");
	});

	test("a row carries the name, where it runs and how it is doing", () => {
		const html = draw([
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
		expect(html).toContain("the rig");
		expect(html).toContain("here");
		expect(html).toContain("working");
	});

	test("the name is the title, then the handle, then the name the bridge gave it", () => {
		expect(nameOf(row({ snapshot: { name: "the rig", handle: "rig" } as never }))).toBe("the rig");
		expect(nameOf(row({ snapshot: { handle: "rig" } as never }))).toBe("rig");
		expect(nameOf(row({ live: { ...live, name: "from the bridge" } }))).toBe("from the bridge");
		expect(nameOf(row({ session: "01a16b0a-8f6e-7249-9571-b11736957af9" }))).toBe("new-7af9");
	});
});
