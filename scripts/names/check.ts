#!/usr/bin/env bun
// Whether a list of animal words is fit to name sessions by, and where it falls short.
// The rules are the ones in docs/remote.md#the-word-list: short, one word, one first three letters
// each so Tab completes it, three edits apart so a typo resolves to one word, and never a word that
// reads as code or as a command. A candidate list is checked here before the operator fixes it,
// because the counts say which rule the list cannot hold.
import { readFileSync, writeFileSync } from "node:fs";

/** The fewest letters and the most a handle may have, so `@` plus the word stays easy to type. */
const SHORTEST = 3;
const LONGEST = 8;
/** Two words this many edits apart still resolve to one word after a single typo. */
const APART = 3;
/** A week of reserved handles at about 70 sessions a day leaves most of the list free. */
const FEWEST = 600;

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

/** The words of a candidate file: one per line, `#` starting a note, or the strings of a module. */
export function wordsIn(text: string): string[] {
	const fromModule = [...text.matchAll(/^[\t ]*["']([a-z]+)["'],?$/gm)].map((match) => match[1]);
	if (fromModule.length > 0) return fromModule.map((word) => word ?? "");
	return text
		.split("\n")
		.map((line) => line.split("#")[0]?.trim() ?? "")
		.filter((word) => word.length > 0);
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
 * The words that can be kept, in the file's order. A word that breaks a rule is left out and the
 * ones after it still count, so one bad candidate costs one word and not the list.
 */
export function audit(candidates: readonly string[]): Audit {
	const removed: Record<string, number> = { shape: 0, denied: 0, letters: 0, close: 0 };
	const left: Audit["left"] = [];
	const kept: string[] = [];
	const seen = new Set<string>();
	const starts = new Map<string, string>();

	for (const raw of candidates) {
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

/** The source of the kit's list, so the file the test reads is the file this wrote. */
export function sourceOf(words: readonly string[]): string {
	const lines = words.map((word) => `\t"${word}",`).join("\n");
	return `// The words a session draws its handle from: animals with character, one first three letters
// each, and three edits apart. \`bun scripts/names/check.ts\` holds the file to the rules in
// docs/remote.md#the-word-list, and the operator fixes the list.
export const WORDS = [
${lines}
] as const;
`;
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

const listPath = new URL("../../packages/kit/src/names/words.ts", import.meta.url).pathname;
const candidatePath = new URL("./candidates.txt", import.meta.url).pathname;
const given = process.argv.slice(2);
const write = given.includes("--write");
const file = given.find((argument) => !argument.startsWith("--")) ?? candidatePath;

const text = readFileSync(file, "utf8");
const report = audit(wordsIn(text));

const shape = report.total - (report.removed.shape ?? 0);
console.log(`${report.total} candidates from ${file}`);
console.log(`  ${shape} are one lowercase word of ${SHORTEST} to ${LONGEST} letters`);
console.log(`  ${shape - (report.removed.denied ?? 0)} read as neither code nor a command`);
console.log(
	`  ${shape - (report.removed.denied ?? 0) - (report.removed.letters ?? 0)} have their own first three letters`,
);
console.log(`  ${report.words.length} are at least ${APART} edits apart, and ${FEWEST} are needed`);

if (report.left.length > 0) {
	console.log("\nleft out:");
	for (const { word, why } of report.left) console.log(`  ${word}: ${why}`);
}

if (write) {
	writeFileSync(listPath, sourceOf(report.words));
	console.log(`\nwrote ${report.words.length} words to ${listPath}`);
}

if (report.words.length < FEWEST) {
	console.error(`\n${FEWEST - report.words.length} words short of the list`);
	process.exit(1);
}
console.log(`\nthe list holds: ${report.words.length} words, ${APART} edits apart`);
