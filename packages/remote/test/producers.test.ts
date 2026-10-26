import { describe, expect, test } from "bun:test";

import { BOARD, emptyBoard, PEERS, type Board, type BoardView } from "@adeildo/pi-kit";
import { emptySessionState } from "@adeildo/pi-remote-protocol";

import { PRODUCERS } from "../src/bridge/producers.ts";

/** A scope with the contracts a test provides, and nothing else. */
function scope(contracts: Record<string, unknown> = {}) {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	return {
		events: {
			emit: (channel: string, data: unknown) => {
				for (const handler of handlers.get(channel) ?? []) handler(data);
			},
			on: (channel: string, handler: (data: unknown) => void) => {
				const set = handlers.get(channel) ?? new Set();
				set.add(handler);
				handlers.set(channel, set);
				return () => set.delete(handler);
			},
		},
		...contracts,
	} as never;
}

/** The board producer, named by the field it owns. */
const board = PRODUCERS.find((one) => one.field === "board")!;
const fold = (state: ReturnType<typeof emptySessionState>, at: ReturnType<typeof scope>) =>
	board.apply(state, { scope: at, entries: [], ctx: {} as never });

const card = (id: string, title: string, at: number) =>
	({ id, title, column: "doing", at }) as const;

/** A board whose view keeps the writer's order, which is the one thing a reader must not change. */
function written(...titles: string[]): Board {
	return {
		...emptyBoard(),
		cards: titles.map((title, index) => card(`c${index + 1}`, title, titles.length - index)),
	};
}

describe("what the session wears", () => {
	const theme = PRODUCERS.find((one) => one.field === "theme")!;

	test("a scope with no room says the accent and nothing about a color", () => {
		const worn = theme.apply(emptySessionState(), {
			scope: scope(),
			entries: [],
			ctx: {} as never,
		});
		// The key is what matters: `toEqual` accepts a written `undefined`, and a color that exists and
		// holds nothing is the absence drawn as a value.
		expect(Object.keys(worn.theme ?? {})).toEqual(["accent"]);
	});

	test("a room that named the session gives the color the terminals draw it in", () => {
		const at = scope();
		PEERS.provide(at, () => ({
			peers: [],
			unread: 0,
			me: { handle: "otter", color: "syntaxKeyword", state: "idle" },
		}));
		const worn = theme.apply(emptySessionState(), { scope: at, entries: [], ctx: {} as never });
		expect(worn.theme).toEqual({ accent: "accent", color: "syntaxKeyword" });
	});
});

describe("the board a session keeps", () => {
	test("a scope with no board leaves the state untouched, which is not an empty board", () => {
		const state = emptySessionState();
		expect(fold(state, scope())).toBe(state);
	});

	test("a scope that has one carries it in the writer's order, and nothing is reordered", () => {
		const board = written("first", "second", "third");
		const at = scope();
		BOARD.provide(at, () => board);
		const served = fold(emptySessionState(), at);
		expect((served.board as BoardView).open.map((one) => one.title)).toEqual([
			"first",
			"second",
			"third",
		]);
	});
});
