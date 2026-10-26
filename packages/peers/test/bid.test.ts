import { describe, expect, test } from "bun:test";

import { fitFor } from "../src/bid.ts";
import type { Peer } from "../src/folder.ts";

/** A model that bids 0.7 and keeps what it was asked. */
function bidding() {
	const asked: string[] = [];
	const registry = {
		streamSimple: (_model: unknown, context: { messages: { content: unknown }[] }) => {
			asked.push(String(context.messages[0]?.content));
			return {
				result: async () => ({
					content: [
						{ type: "toolCall", name: "bid", arguments: { fit: 0.7, reason: "same work" } },
					],
				}),
			};
		},
	};
	return { asked, registry: registry as never };
}

const me: Peer = {
	session: "a",
	startedAt: 0,
	stateAt: 0,
	state: "idle",
	edited: new Map([["src/fleet.ts", 1]]),
	ran: [],
	commits: [],
	board: {
		open: [{ id: "c2", title: "Expose the fleet", column: "doing", at: 1 }],
		backlog: 3,
		done: [{ id: "c1", title: "Count the IPs", column: "done", at: 1 }],
	},
};

describe("the bid", () => {
	test("the model reads the session's board, open cards first, then what it edited", async () => {
		const { asked, registry } = bidding();
		const fit = await fitFor(
			registry,
			[{} as never],
			"add /v1/fleet",
			me,
			AbortSignal.timeout(1000),
		);
		expect(fit).toEqual({ fit: 0.7, reason: "same work" });
		expect(asked[0]).toBe(
			[
				"Request: add /v1/fleet",
				"",
				"- doing: Expose the fleet",
				"- done: Count the IPs",
				"Edited: src/fleet.ts",
			].join("\n"),
		);
	});

	test("a session with nothing on its board says so", async () => {
		const { asked, registry } = bidding();
		const { board: _, ...bare } = me;
		await fitFor(
			registry,
			[{} as never],
			"add /v1/fleet",
			{ ...bare, edited: new Map() },
			AbortSignal.timeout(1000),
		);
		expect(asked[0]).toBe("Request: add /v1/fleet\n\nThe session has nothing on its board yet.");
	});
});
