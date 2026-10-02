// The blocks of generated text inside the markdown files.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The blank lines are where the formatter puts them around an HTML comment. The text between the
// fences can hold anything but a fence, so a block never reaches past its own.
const BLOCK =
	/(<!-- docs:([\w/.-]+) -->\n\n```text\n)((?:(?!```)[\s\S])*)(```\n\n<!-- \/docs -->)/g;

/** The root README, and for every package its README and the pages in its `docs` folder. */
export function markdownFiles(root: string): string[] {
	const files = [join(root, "README.md")];
	for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const folder = join(root, "packages", entry.name);
		files.push(join(folder, "README.md"));
		const docs = join(folder, "docs");
		if (!existsSync(docs)) continue;
		for (const page of readdirSync(docs)) if (page.endsWith(".md")) files.push(join(docs, page));
	}
	return files.filter((file) => existsSync(file));
}

/** Replaces the text of every block with the text drawn for its name. */
export function rewrite(source: string, file: string, drawn: ReadonlyMap<string, string>): string {
	const opened = source.split("<!-- docs:").length - 1;
	const wellFormed = [...source.matchAll(BLOCK)].length;
	if (opened !== wellFormed)
		throw new Error(
			`${file}: ${opened} blocks open and ${wellFormed} are well formed. A block is a marker, a text fence and the closing marker.`,
		);

	return source.replace(
		BLOCK,
		(_block, open: string, name: string, _old: string, close: string) => {
			const text = drawn.get(name);
			if (text === undefined) throw new Error(`${file}: no scene called "${name}"`);
			return `${open}${text}\n${close}`;
		},
	);
}

export function hasBlocks(source: string): boolean {
	return source.includes("<!-- docs:");
}
