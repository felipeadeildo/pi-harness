// Whether the process that wrote an entry still runs. A pid alone cannot say: the system gives a
// freed pid to the next process it starts, so a writer also records when its process started, and a
// pid running with another start belongs to someone else.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** How long a reading is reused on macOS, where each one spawns `ps`. */
const MAC_CACHE_MS = 2_000;
const macCache = new Map<number, { start: string | undefined; at: number }>();

/**
 * When a process started, as the system reports it, or undefined when no such process runs or the
 * system has no way to say. The value is for comparing with another reading, never for parsing.
 */
export function processStart(pid: number): string | undefined {
	if (process.platform === "linux") return linuxStart(pid);
	if (process.platform === "darwin") return macStart(pid);
	return undefined;
}

function linuxStart(pid: number): string | undefined {
	let stat: string;
	try {
		stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	} catch {
		return undefined;
	}
	return startFromStat(stat);
}

/**
 * Field 22 of `/proc/<pid>/stat`: the start, in clock ticks after boot. The command name in field 2
 * may hold spaces and parentheses, so the fields are counted after its last `)`.
 */
export function startFromStat(stat: string): string | undefined {
	const close = stat.lastIndexOf(")");
	if (close < 0) return undefined;
	const start = stat.slice(close + 2).split(" ")[19];
	return start === undefined || start === "" ? undefined : start;
}

function macStart(pid: number): string | undefined {
	const now = Date.now();
	const cached = macCache.get(pid);
	if (cached !== undefined && now - cached.at < MAC_CACHE_MS) return cached.start;
	const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
	const printed = result.status === 0 ? result.stdout.trim() : "";
	const start = printed === "" ? undefined : printed;
	macCache.set(pid, { start, at: now });
	return start;
}

/**
 * Whether the process that wrote an entry runs. With the start the writer recorded, the pid must run
 * with that same start. An entry with no start, written before starts were recorded, falls back to
 * the pid alone, where another user's process counts as running.
 */
export function processLives(
	pid: number,
	start: string | undefined,
	startOf: (pid: number) => string | undefined = processStart,
): boolean {
	if (start !== undefined) return startOf(pid) === start;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
