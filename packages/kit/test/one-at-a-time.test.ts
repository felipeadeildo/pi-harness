import { expect, test } from "bun:test";

import { oneAtATime } from "../src/one-at-a-time.ts";

/** A task that runs until the test lets it end. */
function held(log: string[], name: string) {
	let end!: () => void;
	const ended = new Promise<void>((resolve) => (end = resolve));
	const task = async () => {
		log.push(`${name} starts`);
		await ended;
		log.push(`${name} ends`);
		return name;
	};
	return { task, end };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a task starts only when the one before it ends", async () => {
	const turns = oneAtATime();
	const log: string[] = [];
	const a = held(log, "a");
	const b = held(log, "b");

	const first = turns(a.task);
	const second = turns(b.task);
	await tick();
	expect(log).toEqual(["a starts"]);

	a.end();
	expect(await first).toBe("a");
	await tick();
	expect(log).toEqual(["a starts", "a ends", "b starts"]);

	b.end();
	expect(await second).toBe("b");
});

test("a task that fails lets the next one run", async () => {
	const turns = oneAtATime();
	const failed = turns(() => Promise.reject(new Error("boom")));
	const next = turns(async () => "next");

	await expect(failed).rejects.toThrow("boom");
	expect(await next).toBe("next");
});

test("a task aborted while it waits never runs, and the line keeps its order", async () => {
	const turns = oneAtATime();
	const log: string[] = [];
	const a = held(log, "a");
	const controller = new AbortController();

	const first = turns(a.task);
	const skipped = turns(async () => log.push("skipped runs"), controller.signal);
	const last = turns(async () => log.push("last runs"));

	controller.abort(new Error("gave up"));
	await expect(skipped).rejects.toThrow("gave up");
	await tick();
	expect(log).toEqual(["a starts"]);

	a.end();
	await Promise.all([first, last]);
	expect(log).toEqual(["a starts", "a ends", "last runs"]);
});

test("a signal aborted before the call rejects at once", async () => {
	const turns = oneAtATime();
	const controller = new AbortController();
	controller.abort(new Error("already"));
	let ran = false;
	await expect(
		turns(async () => {
			ran = true;
		}, controller.signal),
	).rejects.toThrow("already");
	await tick();
	expect(ran).toBe(false);
});
