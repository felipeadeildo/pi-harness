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
	commits: [{ sha: "abc1234", subject: "Count the IPs", at: 1 }],
};

describe("the bid", () => {
	test("the model reads what the session edited and committed", async () => {
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
			["Request: add /v1/fleet", "", "Edited: src/fleet.ts", "Committed: Count the IPs"].join("\n"),
		);
	});

	test("a session that touched nothing says so", async () => {
		const { asked, registry } = bidding();
		const bare = { ...me, commits: [] };
		await fitFor(
			registry,
			[{} as never],
			"add /v1/fleet",
			{ ...bare, edited: new Map() },
			AbortSignal.timeout(1000),
		);
		expect(asked[0]).toBe(
			"Request: add /v1/fleet\n\nThe session has not edited or committed anything yet.",
		);
	});
});
