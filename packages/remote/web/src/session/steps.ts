// What a run of steps says about itself: how long it took, what it did, and each step's subject.
import type { StepLine } from "./turns.ts";

export function isRunning(line: StepLine): boolean {
	if (line.kind === "thought") return line.streaming;
	return line.status === "running" || line.status === "writing";
}

/** From the first step that started to the last that ended, or to now while one runs. */
export function spanOf(lines: readonly StepLine[], now: number | undefined): number | undefined {
	let first: number | undefined;
	let last: number | undefined;
	for (const line of lines) {
		const start = line.kind === "tool" ? line.startedAt : line.since;
		if (start === undefined) continue;
		const end = start + (line.durationMs ?? 0);
		first = first === undefined ? start : Math.min(first, start);
		last = last === undefined ? end : Math.max(last, end);
	}
	if (first === undefined || last === undefined) return undefined;
	return (now ?? last) - first;
}

const KINDS: Record<string, [string, string]> = {
	bash: ["command", "commands"],
	read: ["read", "reads"],
	edit: ["edit", "edits"],
	write: ["new file", "new files"],
	grep: ["search", "searches"],
	find: ["search", "searches"],
	ls: ["search", "searches"],
	web_search: ["web lookup", "web lookups"],
	fetch_content: ["web lookup", "web lookups"],
	source_check: ["web lookup", "web lookups"],
};

export function countsOf(lines: readonly StepLine[]): string {
	const counts = new Map<string, [number, string, string]>();
	for (const line of lines) {
		if (line.kind !== "tool") continue;
		const [one, many] = KINDS[line.name] ?? [line.name, line.name];
		const held = counts.get(one);
		counts.set(one, [(held?.[0] ?? 0) + 1, one, many]);
	}
	return [...counts.values()]
		.map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
		.join(", ");
}

/** The command a reader looks for: without the `cd` into the session's folder in front of it. */
export function commandTitle(command: string): string {
	const shown = firstLine(command);
	return shown.replace(/^cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)\s*/, "") || shown;
}

export function firstLine(value: string): string {
	const line = value.trim().split("\n")[0] ?? "";
	return value.trim().includes("\n") ? `${line} …` : line;
}

/** "+3 −1", read from the patch's lines. */
export function changesOf(patch: string): string {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return `+${added} −${removed}`;
}
