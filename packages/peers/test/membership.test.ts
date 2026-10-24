import { describe, expect, test } from "bun:test";

import type { LoggedEvent, LogEventMap, Member } from "@adeildo/pi-kit";

import { Folder, type Posted, receivesFor } from "../src/folder.ts";
import { Membership } from "../src/membership.ts";

let clock = 1_000;

function event<K extends keyof LogEventMap>(
	session: string,
	type: K,
	data: LogEventMap[K],
	at = (clock += 10),
): LoggedEvent<K> {
	return { v: 1, id: `${session}-${at}`, at, session, type, data };
}

const FOLDER: Member = { folder: "/repo" };
const SESSION: Member = { session: "s1", cwd: "/repo" };

function room(...events: LoggedEvent[]): Membership {
	const membership = new Membership();
	for (const one of events) membership.apply(one);
	return membership;
}

describe("how a session stands in a room", () => {
	test("a folder brings every session opened in it in as taking part", () => {
		const membership = room(event("you", "room.added", { member: FOLDER, by: "you" }));
		expect(membership.modeOf("s1", "/repo")).toBe("in");
		expect(membership.modeOf("other", "/elsewhere")).toBe("out");
	});

	test("a session that asked to hear only what names it is listening, not taking part", () => {
		const membership = room(
			event("you", "room.added", { member: FOLDER, by: "you" }),
			event("s1", "room.mode", { member: SESSION, mode: "listening" }),
		);
		expect(membership.modeOf("s1", "/repo")).toBe("listening");
		expect(membership.modeOf("other", "/repo")).toBe("in");
	});

	test("taking part again clears the listening, and it is the same event both ways", () => {
		const membership = room(
			event("you", "room.added", { member: FOLDER, by: "you" }),
			event("s1", "room.mode", { member: SESSION, mode: "listening" }),
			event("s1", "room.mode", { member: SESSION, mode: "in" }),
		);
		expect(membership.modeOf("s1", "/repo")).toBe("in");
	});

	test("a member added already listening stays that way until it changes", () => {
		const membership = room(
			event("you", "room.added", { member: SESSION, by: "you", mode: "listening" }),
		);
		expect(membership.modeOf("s1", "/repo")).toBe("listening");
	});

	test("leaving is the third mode, and adding by name again brings the session back taking part", () => {
		const membership = room(
			event("you", "room.added", { member: FOLDER, by: "you" }),
			event("s1", "room.removed", { member: SESSION }),
		);
		expect(membership.modeOf("s1", "/repo")).toBe("out");
		membership.apply(event("s1", "room.added", { member: SESSION, by: "you" }));
		expect(membership.modeOf("s1", "/repo")).toBe("in");
	});

	test("a closed room holds nobody, whatever they had chosen before", () => {
		const membership = room(
			event("you", "room.added", { member: FOLDER, by: "you" }),
			event("s1", "room.mode", { member: SESSION, mode: "listening" }),
			event("you", "room.closed", {}),
		);
		expect(membership.modeOf("s1", "/repo")).toBe("out");
	});

	test("a folder leaving takes the sessions it brought, listening or not", () => {
		const membership = room(
			event("you", "room.added", { member: FOLDER, by: "you" }),
			event("s1", "room.mode", { member: SESSION, mode: "listening" }),
			event("you", "room.removed", { member: FOLDER }),
		);
		expect(membership.modeOf("s1", "/repo")).toBe("out");
	});
});

describe("what a session standing in each mode takes", () => {
	const message = (to: "all" | "any" | string[]): Posted =>
		({
			id: "m1",
			session: "other",
			from: "agent",
			to,
			text: "hi",
			urgent: false,
			depth: 0,
			at: 0,
			received: new Map(),
			read: new Set(),
			bids: new Map(),
			takenBy: undefined,
		}) as unknown as Posted;

	test("in takes what names nobody, what names everyone and what names this session", () => {
		expect(receivesFor("in", message(["s1"]), "s1")).toBe(true);
		expect(receivesFor("in", message("all"), "s1")).toBe(true);
	});

	test("listening keeps what names the session, and nothing else", () => {
		expect(receivesFor("listening", message(["s1"]), "s1")).toBe(true);
		expect(receivesFor("listening", message(["other"]), "s1")).toBe(false);
	});

	test("listening ignores a message addressed to everyone, because everyone is who takes part", () => {
		expect(receivesFor("listening", message("all"), "s1")).toBe(false);
	});

	test("listening ignores a message addressed to anyone, because anyone is who takes part", () => {
		expect(receivesFor("listening", message("any"), "s1")).toBe(false);
	});

	test("out takes nothing, whatever it is addressed to", () => {
		for (const to of [["s1"], ["s1", "s2"]] as string[][])
			expect(receivesFor("out", message(to), "s1")).toBe(false);
		expect(receivesFor("out", message("all"), "s1")).toBe(false);
		expect(receivesFor("out", message("any"), "s1")).toBe(false);
	});
});

describe("the folder's own room", () => {
	test("has the folder as its first member, so a session opened there takes part at once", () => {
		const room = new Folder("/repo");
		expect(room.membership.modeOf("fresh", "/repo")).toBe("in");
		// A session opened elsewhere is not in it.
		expect(room.membership.modeOf("elsewhere", "/other")).toBe("out");
	});

	test("carries the mode a session asked for, without a `room.added` to say who is in", () => {
		const room = new Folder("/repo");
		room.apply([
			{
				type: "room.mode",
				at: 1,
				session: "quiet",
				data: { member: { session: "quiet", cwd: "/repo" }, mode: "listening" },
			} as LoggedEvent,
		]);
		expect(room.membership.modeOf("quiet", "/repo")).toBe("listening");
		room.apply([
			{
				type: "room.mode",
				at: 2,
				session: "quiet",
				data: { member: { session: "quiet", cwd: "/repo" }, mode: "in" },
			} as LoggedEvent,
		]);
		expect(room.membership.modeOf("quiet", "/repo")).toBe("in");
	});
});

// The contract, not the runtime: a folder joins taking part, and only a session says how it stands.
type FolderAddition = Extract<LogEventMap["room.added"], { member: { folder: string } }>;
// @ts-expect-error a folder has no mode to give
const folderMode: FolderAddition["mode"] = "listening";
void folderMode;
