import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withLock } from "../src/accounts/lock.ts";

function lockPath(): string {
	return join(tmpdir(), `pi-lock-${randomUUID()}.lock`);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("two holders of one lock run one after the other", async () => {
	const path = lockPath();
	const order: string[] = [];
	const first = withLock(path, async () => {
		order.push("first in");
		await sleep(60);
		order.push("first out");
	});
	const second = withLock(path, async () => {
		order.push("second in");
		order.push("second out");
	});

	await Promise.all([first, second]);

	expect(order).toEqual(["first in", "first out", "second in", "second out"]);
});

test("a lock left by a dead process is taken over", async () => {
	const path = lockPath();
	writeFileSync(path, "99999");
	const old = new Date(Date.now() - 120_000);
	utimesSync(path, old, old);

	expect(await withLock(path, async () => "ran")).toBe("ran");
	expect(existsSync(path)).toBe(false);
});

test("a lock that never frees up does not block the work", async () => {
	const path = lockPath();
	writeFileSync(path, "99999");

	expect(await withLock(path, async () => "ran", 100)).toBe("ran");
	expect(existsSync(path)).toBe(true);
});
