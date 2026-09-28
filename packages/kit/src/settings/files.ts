// Where the settings files live and how they are read and written. Every app in a pi process
// shares these files, so a write keeps every key it does not know.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

export type SettingsData = Record<string, unknown>;

export interface SettingsFile {
	data: SettingsData;
	/** What was wrong with the file as a whole. Problems with one key are the store's to report. */
	warnings: string[];
}

export function globalSettingsPath(): string {
	return join(getAgentDir(), "extensions", "pi-harness", "settings.json");
}

export function projectSettingsPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "extensions", "pi-harness", "settings.json");
}

/** A missing file is an empty one. A broken file warns once and reads as empty. */
export function readSettingsFile(path: string): SettingsFile {
	if (!existsSync(path)) return { data: {}, warnings: [] };
	try {
		const data: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isObject(data)) return { data, warnings: [] };
		return { data: {}, warnings: [`${path}: must contain a JSON object; using the defaults`] };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { data: {}, warnings: [`${path}: could not be read (${reason}); using the defaults`] };
	}
}

/** Writes through a temporary file, so a crash mid-write never leaves half a file behind. */
export function writeSettingsFile(path: string, data: SettingsData): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
	renameSync(temporary, path);
}

/** The value at a dotted id like `subscription.claudeCodeVersion`, or undefined. */
export function lookup(data: SettingsData, id: string): unknown {
	let node: unknown = data;
	for (const key of id.split(".")) {
		if (!isObject(node)) return undefined;
		node = node[key];
	}
	return node;
}

/** Sets the value at a dotted id, creating the objects on the way. */
export function assign(data: SettingsData, id: string, value: unknown): void {
	const keys = id.split(".");
	const last = keys.pop();
	if (last === undefined) return;

	let node = data;
	for (const key of keys) {
		const next = node[key];
		if (isObject(next)) {
			node = next;
			continue;
		}
		const created: SettingsData = {};
		node[key] = created;
		node = created;
	}
	node[last] = value;
}
