#!/usr/bin/env bun
// Opens the installed pi bare and with the harness, idle in a terminal, and compares what each costs.
// Exits 1 when the harness costs more memory than the budget. Linux only: it reads /proc.
//
// Usage: bun scripts/bench/memory.ts [--max-mb 30] [--wait 15]
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface Cost {
	rssMb: number;
	peakMb: number;
	cpuMs: number;
}

const root = resolve(import.meta.dir, "../..");
const budgetMb = Number(flag("max-mb") ?? 30);
const waitMs = Number(flag("wait") ?? 15) * 1000;

const bare = await measure([]);
const harness = await measure(["-e", join(root, "packages/harness")]);
const extraMb = harness.rssMb - bare.rssMb;

console.log("            now    peak   cpu to start");
for (const [name, cost] of [
	["bare pi", bare],
	["harness", harness],
] as const)
	console.log(
		`${name.padEnd(10)} ${`${cost.rssMb} MB`.padStart(6)} ${`${cost.peakMb} MB`.padStart(7)} ${`${cost.cpuMs} ms`.padStart(9)}`,
	);
console.log(`the harness adds ${extraMb} MB, and the budget is ${budgetMb} MB`);
if (extraMb > budgetMb) process.exit(1);

async function measure(extensions: string[]): Promise<Cost> {
	const dir = mkdtempSync(join(tmpdir(), "pi-memory-bench-"));
	const child = Bun.spawn(["pi", "--no-session", "-ne", ...extensions], {
		cwd: dir,
		// Its own event log, so the bench session shows up in no room.
		env: { ...process.env, TERM: "xterm-256color", PI_HARNESS_EVENTS: join(dir, "events") },
		terminal: { cols: 160, rows: 50, data: () => {} },
	});
	try {
		await Bun.sleep(waitMs);
		return cost(child.pid);
	} finally {
		child.kill("SIGKILL");
		await child.exited;
		rmSync(dir, { recursive: true, force: true });
	}
}

function cost(pid: number): Cost {
	const status = readFileSync(`/proc/${pid}/status`, "utf8");
	const kb = (key: string): number =>
		Number(new RegExp(`${key}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
	// utime and stime, in clock ticks of 10 ms, after the command name, which may hold spaces.
	const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ") ?? [];
	const ticks = Number(stat[11] ?? 0) + Number(stat[12] ?? 0);
	return {
		rssMb: Math.round(kb("VmRSS") / 1024),
		peakMb: Math.round(kb("VmHWM") / 1024),
		cpuMs: ticks * 10,
	};
}

function flag(name: string): string | undefined {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? undefined : process.argv[at + 1];
}
