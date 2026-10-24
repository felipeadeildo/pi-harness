// The commands typed while the daemon was away. What matters is the clock: inside two minutes they go
// out by themselves after the reconnect, and older ones wait for the person to decide.
import { describe, expect, test } from "bun:test";

import { GOES_ALONE, Outbox } from "../src/outbox.ts";

function clock(start = 0) {
	let now = start;
	return { now: () => now, at: (ms: number) => (now = ms) };
}

const text = { text: "keep going" };

describe("the outbox", () => {
	test("a command typed offline goes out after a reconnect, inside two minutes", () => {
		const time = clock();
		const outbox = new Outbox({ now: time.now, id: () => "c1" });
		const command = outbox.add("prompt.send", text);
		expect(command.state).toBe("waiting");
		expect(outbox.ready()).toHaveLength(1);

		time.at(GOES_ALONE - 1);
		expect(outbox.ready().map((one) => one.id)).toEqual(["c1"]);
		expect(outbox.held()).toEqual([]);
	});

	test("older than two minutes, it waits for the person instead", () => {
		const time = clock();
		const outbox = new Outbox({ now: time.now });
		outbox.add("prompt.send", text);
		time.at(GOES_ALONE + 1);
		expect(outbox.ready()).toEqual([]);
		expect(outbox.held()).toHaveLength(1);

		// The person drops it, and it stops being anything at all.
		const [held] = outbox.held();
		expect(outbox.drop(held?.id ?? "")).toBe(true);
		expect(outbox.all()).toEqual([]);
	});

	test("a command goes out once, and its reply is what ends it", () => {
		const outbox = new Outbox({ now: () => 0 });
		const command = outbox.add("run.abort", {});
		outbox.sent(command.id);
		expect(outbox.ready()).toEqual([]);

		outbox.applied(command.id);
		expect(outbox.all()).toEqual([]);
	});

	test("a refused command stays, saying why", () => {
		const outbox = new Outbox({ now: () => 0 });
		const command = outbox.add("mode.set", { mode: "full" });
		outbox.sent(command.id);
		outbox.refused(command.id, "a client cannot ask for the full mode");

		const [kept] = outbox.all();
		expect(kept?.state).toBe("refused");
		expect(kept?.why).toContain("full mode");
		expect(outbox.ready()).toEqual([]);
	});

	test("a reply for an id nobody holds changes nothing", () => {
		const outbox = new Outbox({ now: () => 0 });
		outbox.sent("nobody");
		outbox.applied("nobody");
		outbox.refused("nobody", "no");
		expect(outbox.all()).toEqual([]);
	});

	test("the order is the order they were typed, not the order they are ready", () => {
		const time = clock();
		const outbox = new Outbox({
			now: time.now,
			id: (() => {
				let n = 0;
				return () => `c${++n}`;
			})(),
		});
		outbox.add("prompt.send", { text: "first" });
		time.at(1000);
		outbox.add("prompt.send", { text: "second" });
		expect(outbox.ready().map((one) => one.id)).toEqual(["c1", "c2"]);
	});
});
