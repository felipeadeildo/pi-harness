#!/usr/bin/env bun
/**
 * Keeps the pictures in the docs true to the code.
 *
 *   bun run docs           write every block
 *   bun run docs:check     fail when a block is out of date (CI, the pre-push hook)
 *   bun run docs:images    also draw the preview images, which needs rsvg-convert and a JetBrains Mono font
 *
 * The scenes are in scenes.ts, and the blocks they fill are marked in the markdown files.
 */
/* oxlint-disable no-await-in-loop -- the scenes run one after another on purpose: they share pi's global theme */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { colorToHex, stripTerminalSequences } from "@earendil-works/pi-tui";
import { $ } from "bun";

import { hasBlocks, markdownFiles, rewrite } from "./blocks.ts";
import { SCENES, type Scene } from "./scenes.ts";
import { toSvg } from "./svg.ts";
import { darkTheme, plainTheme } from "./theme.ts";

const root = resolve(import.meta.dir, "../..");
const args = new Set(process.argv.slice(2));

async function drawText(scene: Scene): Promise<string> {
	const lines = await scene.draw(plainTheme());
	return lines.map((line) => stripTerminalSequences(line).trimEnd()).join("\n");
}

/** Rewrites the blocks of every page and returns the pages that changed. */
async function syncPages(write: boolean): Promise<string[]> {
	const drawn = new Map<string, string>();
	for (const scene of SCENES) drawn.set(scene.name, await drawText(scene));

	const changed: string[] = [];
	for (const file of markdownFiles(root)) {
		const source = readFileSync(file, "utf-8");
		if (!hasBlocks(source)) continue;
		const next = rewrite(source, file, drawn);
		if (next === source) continue;
		changed.push(file.slice(root.length + 1));
		if (write) writeFileSync(file, next);
	}
	return changed;
}

async function drawImages(): Promise<void> {
	const theme = darkTheme();
	const options = { background: "#18181e", foreground: colorToHex(theme.colors.text) };
	for (const scene of SCENES) {
		if (scene.image === undefined) continue;
		const target = join(root, scene.image);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(`${target}.svg`, toSvg(await scene.draw(theme), options));
		await $`rsvg-convert --zoom 2 --output ${`${target}.png`} ${`${target}.svg`}`;
		console.log(`drew ${scene.image}.png`);
	}
}

if (args.has("--check")) {
	const stale = await syncPages(false);
	if (stale.length > 0) {
		console.error(`Out of date, run \`bun run docs\`:\n  ${stale.join("\n  ")}`);
		process.exit(1);
	}
	console.log("The examples in the docs are up to date.");
} else {
	const changed = await syncPages(true);
	console.log(changed.length === 0 ? "Nothing to change." : `Updated ${changed.join(", ")}`);
	if (args.has("--images")) await drawImages();
}
