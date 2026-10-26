// The table in `pi-colors.ts` against pi's own theme files: what the terminal paints a name with is
// what the app paints it with, in both schemes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Theme } from "@earendil-works/pi-coding-agent";

import { PI_COLOR_NAMES, piColor, type Scheme } from "./pi-colors.ts";

const BACKGROUNDS = new Set([
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

/** The hex pi paints `name` with in its theme `scheme`, read from the file pi reads. */
function piHex(scheme: Scheme, name: string): string {
	const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	const file = JSON.parse(
		readFileSync(join(root, `modes/interactive/theme/${scheme}.json`), "utf8"),
	) as { vars: Record<string, string | number>; colors: Record<string, string | number> };
	const resolve = (value: string | number, seen = new Set<string>()): string | number => {
		if (typeof value !== "string") return value;
		const target = file.vars[value];
		return target === undefined || seen.has(value) ? value : resolve(target, seen.add(value));
	};
	const foreground: Record<string, string | number> = {};
	const background: Record<string, string | number> = {};
	for (const [token, value] of Object.entries(file.colors))
		(BACKGROUNDS.has(token) ? background : foreground)[token] = resolve(value);
	const theme = new Theme(
		foreground as ConstructorParameters<typeof Theme>[0],
		background as ConstructorParameters<typeof Theme>[1],
		"truecolor",
		{ name: scheme },
	);
	const found = /38;2;(\d+);(\d+);(\d+)/.exec(theme.getFgAnsi(name as never));
	if (found === null) throw new Error(`pi paints ${name} with no truecolor value`);
	return `#${[1, 2, 3].map((at) => Number(found[at]).toString(16).padStart(2, "0")).join("")}`;
}

describe("the colors a session can wear", () => {
	test("each name is the color pi's theme paints it with, in the dark and in the light", () => {
		expect(PI_COLOR_NAMES.length).toBeGreaterThan(1);
		for (const scheme of ["dark", "light"] as const)
			for (const name of PI_COLOR_NAMES) expect(piColor(scheme, name)).toBe(piHex(scheme, name));
	});

	test("a name the app does not hold has no color, and neither has no name", () => {
		expect(piColor("dark", "syntaxNumber")).toBeUndefined();
		expect(piColor("light", undefined)).toBeUndefined();
	});
});
