import { describe, expect, test } from "bun:test";

import type { BoardCard } from "@adeildo/pi-kit";

import { doing, openCards, stateOf, waiting } from "../src/cards.ts";
import type { Peer } from "../src/folder.ts";

function peer(open: BoardCard[] | undefined, state: Peer["state"] = "idle"): Peer {
	return {
		session: "a",
		startedAt: 0,
		stateAt: 0,
		state,
		edited: new Map(),
		ran: [],
		commits: [],
		...(open === undefined ? {} : { board: { open, backlog: 0, done: [] } }),
	};
}

const at = 1;
const onOperator: BoardCard = {
	id: "c1",
	title: "pick the name",
	column: "todo",
	at,
	blocked: { on: "operator", why: "which name?" },
};
const outside: BoardCard = {
	id: "c2",
	title: "publish",
	column: "doing",
	at,
	blocked: { on: "outside", why: "the store" },
};
const onAgent: BoardCard = {
	id: "c3",
	title: "merge",
	column: "review",
	at,
	blocked: { on: "agent", handle: "badger", why: "the review" },
};
const free: BoardCard = { id: "c4", title: "write the notes", column: "doing", at };

describe("what the room reads of a colleague's board", () => {
	test("a card waits when it is blocked on the operator or outside, not on another agent", () => {
		const cards = waiting(peer([onOperator, outside, onAgent, free]));
		expect(cards.map((card) => card.id)).toEqual(["c1", "c2"]);
		expect(stateOf(peer([onAgent, free], "running"))).toBe("running");
		expect(stateOf(peer([onAgent, onOperator], "running"))).toBe("waiting");
	});

	test("doing is the cards in that column, blocked or not, in the board's order", () => {
		expect(doing(peer([outside, onOperator, free])).map((card) => card.id)).toEqual(["c2", "c4"]);
	});

	test("a session with no board has no cards, and is idle or running as it says", () => {
		const none = peer(undefined, "running");
		expect(doing(none)).toEqual([]);
		expect(waiting(none)).toEqual([]);
		expect(openCards(none)).toBe(0);
		expect(openCards(undefined)).toBe(0);
		expect(stateOf(none)).toBe("running");
		expect(openCards(peer([onOperator, outside, onAgent, free]))).toBe(4);
	});
});
