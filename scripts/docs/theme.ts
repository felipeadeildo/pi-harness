import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initTheme, Theme } from "@earendil-works/pi-coding-agent";

const BACKGROUNDS = new Set([
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

interface ThemeFile {
	vars: Record<string, string | number>;
	colors: Record<string, string | number>;
}

type Palette = ConstructorParameters<typeof Theme>[0];
type BackgroundPalette = ConstructorParameters<typeof Theme>[1];

function resolve(
	value: string | number,
	vars: ThemeFile["vars"],
	seen = new Set<string>(),
): string | number {
	if (typeof value !== "string") return value;
	const target = vars[value];
	if (target === undefined || seen.has(value)) return value;
	return resolve(target, vars, seen.add(value));
}

/** The theme pi ships as `dark`, built from the same file pi reads. */
export function darkTheme(): Theme {
	initTheme("dark", false);
	const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	const file = JSON.parse(
		readFileSync(join(root, "modes/interactive/theme/dark.json"), "utf-8"),
	) as ThemeFile;

	const foreground: Record<string, string | number> = {};
	const background: Record<string, string | number> = {};
	for (const [token, value] of Object.entries(file.colors)) {
		const target = BACKGROUNDS.has(token) ? background : foreground;
		target[token] = resolve(value, file.vars);
	}
	return new Theme(foreground as Palette, background as BackgroundPalette, "truecolor", {
		name: "dark",
	});
}
