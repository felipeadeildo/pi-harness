// Whether the process that wrote an entry still runs. A pid alone cannot say: the system gives a
// freed pid to the next process it starts, so a writer also records when its process started, and a
// pid running with another start belongs to someone else.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** How long one listing of every process is reused on macOS, where listing spawns `ps`. */
const MAC_LISTING_MS = 2_000;
let macListing: { starts: Map<number, string>; at: number } | undefined;

/**
 * When a process started, as the system reports it, or undefined when no such process runs or the
 * system has no way to say. The value is for comparing with another reading, never for parsing. On
 * macOS one listing of every process answers for 2 s, so a pid reused within that window still reads
 * the old start, and a screen asking for many pids spawns `ps` once.
 */
export function processStart(pid: number): string | undefined {
	if (!isPid(pid)) return undefined;
	if (process.platform === "linux") return linuxStart(pid);
	if (process.platform === "darwin") return macStart(pid);
	return undefined;
}

let own: { start: string | undefined } | undefined;

/** This process's start, read once: it never changes while the process runs. */
export function ownStart(): string | undefined {
	own ??= { start: processStart(process.pid) };
	return own.start;
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
	if (macListing === undefined || now - macListing.at >= MAC_LISTING_MS) {
		macListing = { starts: startsFromPs(listProcesses()), at: now };
	}
	return macListing.starts.get(pid);
}

function listProcesses(): string {
	// `ps` prints the date in the caller's locale, and every session must read the same text.
	const result = spawnSync("ps", ["-A", "-o", "pid=,lstart="], {
		encoding: "utf8",
		env: { ...process.env, LC_ALL: "C" },
	});
	return result.status === 0 ? result.stdout : "";
}

/** Each line of `ps -o pid=,lstart=`: the pid, then the start as `ps` prints it. */
export function startsFromPs(listing: string): Map<number, string> {
	const starts = new Map<number, string>();
	for (const line of listing.split("\n")) {
		const match = /^\s*(\d+)\s+(\S.*\S)\s*$/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined) starts.set(Number(match[1]), match[2]);
	}
	return starts;
}

/**
 * Whether the process that wrote an entry runs. With the start the writer recorded, the pid must run
 * with that same start. An entry with no start, written before starts were recorded, falls back to
 * the pid alone, where another user's process counts as running, and so does a reader on a system
 * that reports no starts at all.
 */
export function processLives(
	pid: number,
	start: string | undefined,
	startOf: (pid: number) => string | undefined = processStart,
): boolean {
	// 0 and -1 would signal a whole group of processes, which always answers.
	if (!isPid(pid)) return false;
	if (start !== undefined) {
		const now = startOf(pid);
		if (now !== undefined) return now === start;
		// Nothing to compare: the pid is gone, unless this system cannot tell any start at all.
		if (startOf(process.pid) !== undefined) return false;
	}
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
