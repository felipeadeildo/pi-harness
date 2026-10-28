#!/usr/bin/env bun
// Every PNG carries the hash of the SVG it was drawn from, so the check needs no renderer and
// `bun run docs` redraws only what changed.
/* oxlint-disable no-await-in-loop -- the scenes share pi's global theme, so they run in turn */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToHex } from "@earendil-works/pi-tui";
import { $ } from "bun";

import { markdownFiles, rewrite } from "./blocks.ts";
import { bannerBlock, bannerSvg, footerBlock, iconSvg, markSvg, socialSvg } from "./brand.ts";
import { readKey, withKey } from "./png.ts";
import { SCENES, type Scene } from "./scenes.ts";
import { toSvg } from "./svg.ts";
import { darkTheme } from "./theme.ts";

const root = resolve(import.meta.dir, "../..");
const RAW = "https://raw.githubusercontent.com/felipeadeildo/pi-harness/main";
/** Wide enough to read at GitHub's column. */
const PICTURE_WIDTH = 860;

interface Picture {
	name: string;
	file: string;
	svg: string;
	key: string;
	caption: string;
	alt: string;
	/** How many pixels a unit of the SVG becomes; 2 by default, for sharp text. */
	zoom?: number;
}

/** A picture drawn from an SVG made by hand, with no caption: the brand. */
function brandPicture(file: string, svg: string, zoom = 1): Picture {
	const key = createHash("sha256").update(svg).digest("hex");
	return { name: file, file, svg, key, caption: "", alt: "", zoom };
}

async function picture(scene: Scene, theme: Theme): Promise<Picture> {
	const [pkg, name] = scene.name.split("/");
	const file = `packages/${pkg}/assets/${name}.png`;
	const svg = toSvg(await scene.draw(theme), {
		background: "#18181e",
		foreground: colorToHex(theme.colors.text),
	});

	return {
		name: scene.name,
		file,
		svg,
		key: createHash("sha256").update(svg).digest("hex"),
		caption: scene.caption,
		alt: scene.alt,
	};
}

function imageTag(shot: Picture, width: number): string {
	return `  <img src="${RAW}/${shot.file}" alt="${escape(shot.alt)}" width="${width}">`;
}

/** One picture, and the line under it. */
function pictureBlock(shot: Picture): string {
	return [
		`<p align="center">`,
		imageTag(shot, PICTURE_WIDTH),
		`  <br>`,
		`  <em>${escape(shot.caption)}</em>`,
		`</p>`,
	].join("\n");
}

/** Two wide pictures, one under the other at full width, under the line the first one carries. */
function stackBlock(top: Picture, bottom: Picture): string {
	return [
		`<p align="center">`,
		imageTag(top, PICTURE_WIDTH),
		`  <br>`,
		imageTag(bottom, PICTURE_WIDTH),
		`  <br>`,
		`  <em>${escape(top.caption)}</em>`,
		`</p>`,
	].join("\n");
}

/** Narrower than this, two pictures fit side by side in one picture and still read. */
const NARROW_PX = 900;

function sizeOf(svg: string): { width: number; height: number } {
	const width = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0);
	const height = Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 0);
	return { width, height };
}

/**
 * Two narrow pictures drawn as one, side by side: two images in a row wrap on a narrow page, and one
 * picture scales with it.
 */
function pairPicture(left: Picture, right: Picture): Picture {
	const gap = 24;
	const a = sizeOf(left.svg);
	const b = sizeOf(right.svg);
	const width = a.width + gap + b.width;
	const height = Math.max(a.height, b.height);
	// The shorter picture sits in the middle of the taller one's height.
	const place = (svg: string, x: number, own: number) =>
		svg.replace(
			/^<svg [^>]*?(width="[^"]*" height="[^"]*" viewBox="[^"]*")>/,
			`<svg x="${x}" y="${Math.round((height - own) / 2)}" $1>`,
		);
	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		place(left.svg, 0, a.height),
		place(right.svg, a.width + gap, b.height),
		"</svg>",
		"",
	].join("\n");
	return {
		name: `${left.name}+${right.name}`,
		file: left.file.replace(/\.png$/, "-pair.png"),
		svg,
		key: createHash("sha256").update(svg).digest("hex"),
		caption: left.caption,
		alt: `${left.alt} ${right.alt}`,
	};
}

function escape(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function isStale(entry: Picture): boolean {
	const path = join(root, entry.file);
	return !existsSync(path) || readKey(readFileSync(path)) !== entry.key;
}

async function draw(entry: Picture): Promise<void> {
	const zoom = entry.zoom ?? 2;
	const png = await $`rsvg-convert --zoom ${zoom} - < ${new Response(entry.svg)}`.arrayBuffer();
	writeFileSync(join(root, entry.file), withKey(new Uint8Array(png), entry.key));
}

function syncPages(blocks: ReadonlyMap<string, string>, write: boolean): string[] {
	const changed: string[] = [];
	for (const file of markdownFiles(root)) {
		const source = readFileSync(file, "utf-8");
		if (!source.includes("<!-- docs:")) continue;
		const next = rewrite(source, file, blocks);
		if (next === source) continue;
		changed.push(file.slice(root.length + 1));
		if (write) writeFileSync(file, next);
	}
	return changed;
}

const theme = darkTheme();
const pictures: Picture[] = [];
for (const scene of SCENES) pictures.push(await picture(scene, theme));

// A scene with `beside` puts both pictures in one row, so only the first of the two gets a block.
const byName = new Map(pictures.map((entry) => [entry.name, entry]));
const blocks = new Map<string, string>();
for (const scene of SCENES) {
	const mine = byName.get(scene.name);
	if (mine === undefined) continue;
	if (scene.beside === undefined) {
		blocks.set(scene.name, pictureBlock(mine));
		continue;
	}
	const partner = byName.get(scene.beside);
	if (partner === undefined)
		throw new Error(`no scene called "${scene.beside}" to sit beside ${scene.name}`);
	if (sizeOf(mine.svg).width < NARROW_PX && sizeOf(partner.svg).width < NARROW_PX) {
		const pair = pairPicture(mine, partner);
		pictures.push(pair);
		blocks.set(scene.name, pictureBlock(pair));
	} else blocks.set(scene.name, stackBlock(mine, partner));
}
// The brand: the icon, the banner in both themes, GitHub's social picture, and the remote page's
// icons, so the page and the README show the same π.
const WEB = "packages/remote/web/public";
pictures.push(
	brandPicture("assets/brand/icon.png", iconSvg(512)),
	brandPicture("assets/brand/banner-dark.png", bannerSvg("dark"), 2),
	brandPicture("assets/brand/banner-light.png", bannerSvg("light"), 2),
	brandPicture("assets/brand/social.png", socialSvg()),
	brandPicture(`${WEB}/favicon.png`, iconSvg(64, 0.875)),
	brandPicture(`${WEB}/apple-touch-icon.png`, iconSvg(180)),
);
blocks.set("banner", bannerBlock(RAW));
blocks.set("footer", footerBlock());
const vectors = new Map<string, string>([
	["assets/brand/icon.svg", iconSvg(512)],
	[`${WEB}/icon.svg`, iconSvg(64, 0.875)],
	[`${WEB}/mark.svg`, markSvg()],
]);
const staleVectors = [...vectors].filter(
	([file, svg]) => !existsSync(join(root, file)) || readFileSync(join(root, file), "utf-8") !== svg,
);

const stale = pictures.filter(isStale);
const write = !process.argv.includes("--check");

if (write) {
	mkdirSync(join(root, "assets/brand"), { recursive: true });
	await Promise.all(stale.map((entry) => draw(entry)));
	for (const [file, svg] of staleVectors) writeFileSync(join(root, file), svg);
}
const changed = [
	...syncPages(blocks, write),
	...stale.map((entry) => entry.file),
	...staleVectors.map(([file]) => file),
];

if (!write && changed.length > 0) {
	console.error(`Out of date, run \`bun run docs\`:\n  ${changed.join("\n  ")}`);
	process.exit(1);
}
if (write)
	console.log(changed.length === 0 ? "Nothing to change." : `Updated ${changed.join(", ")}`);
else console.log("The pictures in the docs are up to date.");
