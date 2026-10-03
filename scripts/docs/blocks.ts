import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BLOCK = /(<!-- docs:([\w/.-]+) -->\n)([\s\S]*?)(<!-- \/docs -->)/g;

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

export function rewrite(source: string, file: string, blocks: ReadonlyMap<string, string>): string {
	const opened = source.split("<!-- docs:").length - 1;
	if (opened !== [...source.matchAll(BLOCK)].length)
		throw new Error(
			`${file}: a block opens with <!-- docs:name --> and closes with <!-- /docs -->`,
		);

	return source.replace(
		BLOCK,
		(_block, open: string, name: string, _old: string, close: string) => {
			const block = blocks.get(name);
			if (block === undefined) throw new Error(`${file}: no scene called "${name}"`);
			return `${open}\n${block}\n\n${close}`;
		},
	);
}
