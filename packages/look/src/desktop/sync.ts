// Keeps `~/.pi/agent/themes/desktop.json` equal to the desktop palette. Pi reloads the active theme
// from that folder by itself, so changing the wallpaper recolours a running pi with no restart.
import { type FSWatcher, watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { DESKTOP_THEME, desktopTheme, missingColors, parseDesktopColors } from "./palette.ts";

/** matugen writes a few files in a burst; one rewrite per burst is enough. */
const SETTLE_MS = 250;

export type SyncResult =
	| { kind: "written"; path: string }
	| { kind: "unchanged"; path: string }
	| { kind: "missing" }
	| { kind: "invalid"; reason: string };

export function themePath(): string {
	return join(getAgentDir(), "themes", `${DESKTOP_THEME}.json`);
}

export function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

/** Writes the theme when the palette differs from what is on disk. */
export async function syncDesktopTheme(source: string): Promise<SyncResult> {
	let raw: string;
	try {
		raw = await readFile(expandHome(source), "utf8");
	} catch {
		return { kind: "missing" };
	}

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { kind: "invalid", reason: "the palette file is not JSON" };
	}

	const colors = parseDesktopColors(json);
	if (colors === undefined) return { kind: "invalid", reason: "not a DankMaterialShell palette" };
	const missing = missingColors(colors);
	if (missing.length > 0) return { kind: "invalid", reason: `missing ${missing.join(", ")}` };

	const path = themePath();
	const next = `${JSON.stringify(desktopTheme(colors), null, "\t")}\n`;
	const current = await readFile(path, "utf8").catch(() => undefined);
	if (current === next) return { kind: "unchanged", path };

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, next);
	return { kind: "written", path };
}

/**
 * Watches the folder rather than the file: tools that write atomically replace the file, and a
 * watch on the old one goes quiet.
 */
export function watchDesktopPalette(source: string, changed: () => void): () => void {
	const path = expandHome(source);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let watcher: FSWatcher | undefined;

	try {
		watcher = watch(dirname(path), (_event, file) => {
			if (file !== null && file !== basename(path)) return;
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(changed, SETTLE_MS);
			timer.unref?.();
		});
		watcher.unref?.();
		watcher.on("error", () => watcher?.close());
	} catch {
		return () => {};
	}

	return () => {
		if (timer !== undefined) clearTimeout(timer);
		watcher?.close();
	};
}
