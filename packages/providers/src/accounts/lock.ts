// Serializes the refresh across pi processes. A lock older than its deadline belonged to a process
// that died, and is taken over.
import { statSync, unlinkSync, writeFileSync } from "node:fs";

const STALE_MS = 60_000;
const RETRY_MS = 50;
const WAIT_MS = 5_000;

/** Runs `work` holding the lock, or without it when it cannot be taken in time. */
export async function withLock<T>(
	path: string,
	work: () => Promise<T>,
	waitMs = WAIT_MS,
): Promise<T> {
	const deadline = Date.now() + waitMs;
	while (!take(path)) {
		if (Date.now() >= deadline) return await work();
		// oxlint-disable-next-line no-await-in-loop -- the lock is retried until its deadline.
		await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
	}
	try {
		return await work();
	} finally {
		release(path);
	}
}

function take(path: string): boolean {
	try {
		// Opens, writes and closes in one call: handing writeSync's return value to closeSync closed
		// the byte count, and for a 5 or 6 digit pid that count is a descriptor libuv owns.
		writeFileSync(path, String(process.pid), { flag: "wx" });
		return true;
	} catch {
		dropStale(path);
		return false;
	}
}

function dropStale(path: string): void {
	try {
		if (Date.now() - statSync(path).mtimeMs > STALE_MS) unlinkSync(path);
	} catch {
		// The holder released it between the open and the stat, which is the good case.
	}
}

function release(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Already gone, which is also the point.
	}
}
