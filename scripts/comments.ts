#!/usr/bin/env bun
// Fails on the comments CONTRIBUTING rules out: history, pull request numbers, and blocks too long to
// be a comment.
import { $ } from "bun";

const LONGEST = 6;
const HISTORY = /\b(used to|anymore|previously|was renamed)\b/i;
// `#123` alone is a pull request; `owner/repo#123` and a URL name something outside this repository.
const PULL_REQUEST = /(^|[^\w/])#\d{2,}\b/;

const files = (await $`git ls-files '*.ts' '*.tsx'`.text()).split("\n").filter(Boolean);
const problems: string[] = [];

for (const file of files) {
	const lines = (await Bun.file(file).text()).split("\n");
	let start = -1;
	let block = false;
	lines.forEach((line, index) => {
		const text = line.trim();
		const comment = block || text.startsWith("//") || text.startsWith("/*");
		const trailing = comment ? undefined : /\s\/\/\s(.*)$/.exec(text)?.[1];
		if (trailing !== undefined && PULL_REQUEST.test(trailing))
			problems.push(`${file}:${index + 1}: names a pull request`);
		if (comment) {
			if (start === -1) start = index;
			if (HISTORY.test(text)) problems.push(`${file}:${index + 1}: tells history; git keeps it`);
			if (PULL_REQUEST.test(text)) problems.push(`${file}:${index + 1}: names a pull request`);
			if (text.startsWith("/*") && !text.includes("*/")) block = true;
			else if (block && text.includes("*/")) block = false;
		}
		const next = lines[index + 1]?.trim() ?? "";
		const continues = block || (text.startsWith("//") && next.startsWith("//"));
		if (start !== -1 && (!comment || !continues)) {
			const length = index - start + (comment ? 1 : 0);
			if (length > LONGEST)
				problems.push(
					`${file}:${start + 1}: a comment of ${length} lines; say it in ${LONGEST} or fewer`,
				);
			start = -1;
		}
	});
}

if (problems.length > 0) {
	for (const problem of problems) console.error(problem);
	process.exit(1);
}
console.log(`The comments in ${files.length} files keep to CONTRIBUTING.`);
