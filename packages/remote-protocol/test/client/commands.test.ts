import { describe, expect, test } from "bun:test";

import { memoryCache } from "../../src/client/cache.ts";
import { connect } from "../../src/client/connection.ts";

/**
 * The payload of a command is typed by the protocol, so a screen cannot send `mode.set` with a
 * thinking level or `ask.answer` without a result. This file is the type-level half of the outbox:
 * the assertions are compiled, and the test only checks what the type cannot.
 */
describe("a command carries the fields its type names", () => {
	test("what is queued is what was typed, and the type survives the queue", () => {
		const client = connect({
			key: { machine: "box", session: "s1" },
			cache: memoryCache(),
			open: () => ({ send: () => {}, close: () => {} }),
		});
		client.send("mode.set", { mode: "judge" });
		client.send("queue.clear", { ids: ["a"] });
		client.send("ask.answer", { ask: "q1", result: { answers: [], cancelled: true } });

		const queued = client.outbox().all();
		expect(queued.map((one) => one.type)).toEqual(["mode.set", "queue.clear", "ask.answer"]);
		expect(queued[0]?.data).toEqual({ mode: "judge" });
		expect(queued[1]?.data).toEqual({ ids: ["a"] });
		client.stop();
	});
});
