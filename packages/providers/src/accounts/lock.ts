// Serializes the refresh across pi processes. A lock past its deadline belonged to a dead process.
import { statSync, unlinkSync, writeFileSync } from "node:fs";

const STALE_MS = 60_000;
const RETRY_MS = 50;
const WAIT_MS = 5_000;

/** Runs without it when it cannot be taken in time. */
export async function withLock<T>(
	path: string,
	work: () => Promise<T>,
	waitMs = WAIT_MS,
): Promise<T> {
	const deadline = Date.now() + waitMs;
	while (!take(path)) {
		if (Date.now() >= deadline) return work();
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
		// One call, so no descriptor is closed by mistake.
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
