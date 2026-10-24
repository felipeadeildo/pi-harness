// The rules a word list must hold, from docs/remote.md#the-word-list: short, one word, one first
// three letters each so Tab completes it, two edits apart so a typo cannot turn one handle into
// another, and never a word that reads as code or as a command. The list's test asserts them here,
// and scripts/names/check.ts prints the counts a candidate list gets under each one.

/** The fewest letters and the most a handle may have, so `@` plus the word stays easy to type. */
export const SHORTEST = 3;
export const LONGEST = 8;
/**
 * Two words this many edits apart, the most the list can hold: short animal names crowd, so at three
 * edits 1,058 candidates leave 484 words, and 600 are needed; at two they leave 606. One typo still
 * cannot turn one handle into another; Tab may offer a second word when the typo lands one edit
 * from it.
 */
export const APART = 2;
/** A week of reserved handles at about 70 sessions a week leaves most of the list free. */
export const FEWEST = 600;

/**
 * Words that read as code, as an instruction or as a command of pi or of the harness. None of them
 * is an animal, so the list does not lose anything by keeping them out, and a handle that reads as
 * `@test` or `@build` would be taken for an instruction in a message.
 */
const DENIED = new Set([
	"add",
	"api",
	"app",
	"ask",
	"auth",
	"bash",
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

/**
 * The words that can be kept, in alphabetical order. The order of the candidate file must not
 * change the answer, since the first word of a shared prefix wins and the chosen word is what the
 * list ends up with. A word that breaks a rule is left out and the ones after it still count.
 */
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
