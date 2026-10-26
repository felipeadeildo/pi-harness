// The commands typed while the daemon was away. What matters is the clock: inside two minutes they go
// out by themselves after the reconnect, and older ones wait for the person to decide.
import { describe, expect, test } from "bun:test";

import { GOES_ALONE, Outbox, randomId } from "../../src/client/outbox.ts";

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

	test("a command sent and never answered goes out again on a new connection", () => {
		const outbox = new Outbox({ now: () => 0 });
		const command = outbox.add("prompt.send", text);
		outbox.sent(command.id);
		expect(outbox.ready()).toEqual([]);

		outbox.resume();
		expect(outbox.ready().map((one) => one.id)).toEqual([command.id]);
	});

	test("the person can release a held command, and it keeps its id", () => {
		const time = clock();
		const outbox = new Outbox({ now: time.now, id: () => "c1" });
		const command = outbox.add("prompt.send", text);
		time.at(GOES_ALONE + 1);
		expect(outbox.held().map((one) => one.id)).toEqual(["c1"]);

		expect(outbox.release(command.id)).toBe(true);
		expect(outbox.ready().map((one) => one.id)).toEqual(["c1"]);
		expect(outbox.release("nobody")).toBe(false);
	});

	test("two clients never make the same id", () => {
		const one = new Outbox().add("prompt.send", text);
		const other = new Outbox().add("prompt.send", text);
		expect(one.id).not.toBe(other.id);
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

describe("a command's id", () => {
	test("is a v4 UUID even where the page is not a secure context and randomUUID is missing", () => {
		const insecure = {
			getRandomValues: (array: Uint8Array) => crypto.getRandomValues(array),
		};
		const ids = new Set(Array.from({ length: 50 }, () => randomId(insecure)));
		expect(ids.size).toBe(50);
		for (const id of ids)
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});
});
