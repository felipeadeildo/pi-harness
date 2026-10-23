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
 * system has no way to say. The value is for comparing with another reading, never for parsing. On
 * macOS a reading is reused for 2 s, so a pid reused within that window still reads the old start.
 */
export function processStart(pid: number): string | undefined {
	if (!isPid(pid)) return undefined;
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
 * may hold spaces and parentheses, so the fields are counted after its last `)`. A zombie, state `Z`,
 * has exited and only waits for its parent, so it has no start to compare.
 */
export function startFromStat(stat: string): string | undefined {
	const close = stat.lastIndexOf(")");
	if (close < 0) return undefined;
	const fields = stat.slice(close + 2).split(" ");
	const start = fields[19];
	if (fields[0] === "Z" || start === undefined || start === "") return undefined;
	return start;
}

function macStart(pid: number): string | undefined {
	const now = Date.now();
	const cached = macCache.get(pid);
	if (cached !== undefined && now - cached.at < MAC_CACHE_MS) return cached.start;
	// `ps` prints the date in the caller's locale, and every session must read the same text.
	const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
		encoding: "utf8",
		env: { ...process.env, LC_ALL: "C" },
	});
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
	// 0 and -1 would signal a whole group of processes, which always answers.
	if (!isPid(pid)) return false;
	if (start !== undefined) return startOf(pid) === start;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function isPid(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0;
}
