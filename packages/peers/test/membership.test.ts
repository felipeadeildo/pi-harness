import { describe, expect, test } from "bun:test";

import type { LoggedEvent, LogEventMap, Member } from "@adeildo/pi-kit";

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
