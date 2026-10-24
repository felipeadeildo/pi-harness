#!/usr/bin/env bun
// Checks a candidate list against the word list's rules, prints how many words survive each, and
// writes the kit's list with `--write`. The rules live in packages/kit/src/names/rules.ts, beside
// the list they hold; this script reads a file, counts, and writes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { APART, audit, FEWEST, LONGEST, SHORTEST } from "../../packages/kit/src/names/rules.ts";

/** The words of a candidate file: one per line, `#` starting a note, or the strings of a module. */
export function wordsIn(text: string): string[] {
	const fromModule = [...text.matchAll(/^[\t ]*["']([a-z]+)["'],?$/gm)].map((match) => match[1]);
	if (fromModule.length > 0) return fromModule.map((word) => word ?? "");
	return text
		.split("\n")
		.map((line) => line.split("#")[0]?.trim() ?? "")
		.filter((word) => word.length > 0);
}

/** The source of the kit's list, so the file the test reads is the file this wrote. */
export function sourceOf(words: readonly string[]): string {
	const lines = words.map((word) => `\t"${word}",`).join("\n");
	return `// The words a session draws its handle from: animals with character, one first three letters
// each, and two edits apart. \`bun scripts/names/check.ts\` holds the file to the rules in
// \`names/rules.ts\`, and the operator fixes the list.
export const WORDS = [
${lines}
] as const;
`;
}

const listPath = new URL("../../packages/kit/src/names/words.ts", import.meta.url).pathname;
const candidatePath = new URL("./candidates.txt", import.meta.url).pathname;

/** Audits a candidate file and, with `--write`, writes the kit's list when the list holds. */
function main(given: readonly string[]): void {
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
	console.log(
		`  ${report.words.length} are at least ${APART} edits apart, and ${FEWEST} are needed`,
	);

	if (report.left.length > 0) {
		console.log("\nleft out:");
		for (const { word, why } of report.left) console.log(`  ${word}: ${why}`);
	}

	// A short list is a failed run, so it must not leave a broken file behind for the next check.
	if (report.words.length < FEWEST) {
		console.error(`\n${FEWEST - report.words.length} words short of the list, nothing written`);
		process.exit(1);
	}
	if (write) {
		mkdirSync(dirname(listPath), { recursive: true });
		writeFileSync(listPath, sourceOf(report.words));
		console.log(`\nwrote ${report.words.length} words to ${listPath}`);
	}
	console.log(`\nthe list holds: ${report.words.length} words, ${APART} edits apart`);
}

if (import.meta.main) main(process.argv.slice(2));
