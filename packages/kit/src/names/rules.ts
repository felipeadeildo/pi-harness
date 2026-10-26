// The word list's rules: short, one word, unique first three letters for Tab, two edits apart, and
// nothing that reads as code or a command. `scripts/names/check.ts` reports a candidate list.

/** The fewest letters and the most a handle may have, so `@` plus the word stays easy to type. */
export const SHORTEST = 3;
export const LONGEST = 8;
/** Three edits would leave 484 of 1,057 candidates; 600 are needed. */
export const APART = 2;
/** A week of reserved handles at about 70 sessions a week leaves most of the list free. */
export const FEWEST = 600;

/** Animals that read as commands (`bat`, `dog`, `pig`) stay out too. */
const DENIED = new Set([
	"add",
	"api",
	"app",
	"ask",
	"auth",
	"bash",
	"bat",
	"bin",
	"branch",
	"build",
	"cache",
	"check",
	"clean",
	"clear",
	"clone",
	"close",
	"code",
	"commit",
	"compact",
	"config",
	"copy",
	"create",
	"data",
	"debug",
	"delete",
	"deploy",
	"dev",
	"diff",
	"dir",
	"dist",
	"docs",
	"dog",
	"drop",
	"edit",
	"env",
	"error",
	"exec",
	"exit",
	"fetch",
	"file",
	"find",
	"fix",
	"fork",
	"full",
	"get",
	"git",
	"grep",
	"help",
	"host",
	"http",
	"init",
	"install",
	"judge",
	"key",
	"kill",
	"lint",
	"list",
	"load",
	"lock",
	"log",
	"login",
	"look",
	"main",
	"make",
	"manual",
	"map",
	"memory",
	"merge",
	"mode",
	"model",
	"move",
	"name",
	"new",
	"node",
	"open",
	"pack",
	"parse",
	"pass",
	"patch",
	"path",
	"peer",
	"peers",
	"pig",
	"push",
	"quit",
	"read",
	"rebase",
	"reload",
	"remote",
	"rename",
	"reset",
	"resume",
	"rm",
	"room",
	"root",
	"run",
	"save",
	"screen",
	"sed",
	"session",
	"set",
	"setting",
	"setup",
	"shell",
	"show",
	"skill",
	"sort",
	"src",
	"start",
	"stash",
	"stop",
	"sync",
	"task",
	"temp",
	"test",
	"token",
	"tool",
	"type",
	"undo",
	"update",
	"url",
	"user",
	"view",
	"warn",
	"write",
]);

export interface Audit {
	/** Every word the file held, duplicates counted once. */
	total: number;
	/** The words that break no rule, in the order of the file. */
	words: string[];
	/** One line per word left out, saying which rule it broke. */
	left: { word: string; why: string }[];
	/** How many words each rule removed, so a count is easy to compare. */
	removed: Record<string, number>;
}

/** Phone-book distance: how many single-letter edits turn one word into the other. */
export function distance(a: string, b: string): number {
	const before = new Uint16Array(b.length + 1);
	const after = new Uint16Array(b.length + 1);
	for (let column = 0; column <= b.length; column++) before[column] = column;
	for (let row = 1; row <= a.length; row++) {
		after[0] = row;
		for (let column = 1; column <= b.length; column++) {
			const same = a[row - 1] === b[column - 1] ? 0 : 1;
			after[column] = Math.min(
				(before[column] ?? 0) + 1,
				(after[column - 1] ?? 0) + 1,
				(before[column - 1] ?? 0) + same,
			);
		}
		before.set(after);
	}
	return before[b.length] ?? 0;
}

/** Alphabetical, so the candidate file's order cannot change which word of a shared prefix wins. */
export function audit(candidates: readonly string[]): Audit {
	const removed: Record<string, number> = { shape: 0, denied: 0, letters: 0, close: 0 };
	const left: Audit["left"] = [];
	const kept: string[] = [];
	const seen = new Set<string>();
	const starts = new Map<string, string>();

	for (const raw of candidates.map((word) => word.toLowerCase()).toSorted()) {
		const word = raw.toLowerCase();
		if (seen.has(word)) continue;
		seen.add(word);

		if (!/^[a-z]+$/.test(word) || word.length < SHORTEST || word.length > LONGEST) {
			removed.shape = (removed.shape ?? 0) + 1;
			left.push({ word, why: `not one lowercase word of ${SHORTEST} to ${LONGEST} letters` });
			continue;
		}
		if (DENIED.has(word)) {
			removed.denied = (removed.denied ?? 0) + 1;
			left.push({ word, why: "reads as code or as a command" });
			continue;
		}
		const start = word.slice(0, 3);
		const owner = starts.get(start);
		if (owner !== undefined) {
			removed.letters = (removed.letters ?? 0) + 1;
			left.push({ word, why: `starts with ${start}, as ${owner} does` });
			continue;
		}
		const near = kept.find((other) => distance(word, other) < APART);
		if (near !== undefined) {
			removed.close = (removed.close ?? 0) + 1;
			left.push({ word, why: `less than ${APART} edits from ${near}` });
			continue;
		}
		starts.set(start, word);
		kept.push(word);
	}

	return { total: seen.size, words: kept, left, removed };
}

/** The shortest list that fails, or undefined when the list holds every rule. */
export function problemWith(words: readonly string[]): string | undefined {
	const report = audit(words);
	if (report.words.length < FEWEST)
		return `a list of ${report.words.length} words, and ${FEWEST} are needed`;
	if (report.left.length > 0)
		return `left out ${report.left.map((one) => `${one.word} (${one.why})`).join(", ")}`;
	return undefined;
}
