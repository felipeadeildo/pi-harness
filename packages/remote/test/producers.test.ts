import { describe, expect, test } from "bun:test";

import { BOARD, emptyBoard, type Board, type BoardView } from "@adeildo/pi-kit";
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

/** The board producer, which is the first entry: it carries the board and nothing else. */
const board = PRODUCERS[0] as (typeof PRODUCERS)[number];
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
