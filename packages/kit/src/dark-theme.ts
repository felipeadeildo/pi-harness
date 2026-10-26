import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Theme } from "@earendil-works/pi-coding-agent";

/** The tokens a theme paints as a background rather than as a foreground. */
const BACKGROUND_TOKENS = new Set([
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

/** Read from pi's own theme file, so a pi release that moves it fails loudly. */
export function darkTheme(): Theme {
	const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	const file = JSON.parse(
		readFileSync(join(root, "modes/interactive/theme/dark.json"), "utf8"),
	) as { vars: Record<string, string | number>; colors: Record<string, string | number> };
	const resolve = (value: string | number, seen: Set<string>): string | number => {
		if (typeof value !== "string") return value;
		const target = file.vars[value];
		if (target === undefined || seen.has(value)) return value;
		return resolve(target, seen.add(value));
	};
	const foreground: Record<string, string | number> = {};
	const background: Record<string, string | number> = {};
	for (const [token, value] of Object.entries(file.colors)) {
		const target = BACKGROUND_TOKENS.has(token) ? background : foreground;
		target[token] = resolve(value, new Set());
	}
	return new Theme(
		foreground as ConstructorParameters<typeof Theme>[0],
		background as ConstructorParameters<typeof Theme>[1],
		"truecolor",
		{ name: "dark" },
	);
}
