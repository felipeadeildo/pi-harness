// The 3.x config.json, which only the migration reads. Always yes files stay here: they are state,
// and a project's has to live in that project.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { ALWAYS_YES_FILE } from "#core/always-yes.ts";
import { decodeConfig } from "#core/config/decode.ts";
import { defaultConfig, type PermissionConfig } from "#core/config/schema.ts";
import { FOLDERS_FILE } from "#core/folders.ts";
import { CONFIG_DIR } from "#identity";
import { describe, isRecord } from "#util/primitives.ts";

export interface LegacyConfig {
	config: PermissionConfig;
	path: string;
	warnings: string[];
}

export function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_DIR, "config.json");
}

export function globalAlwaysYesPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_DIR, ALWAYS_YES_FILE);
}

export function projectAlwaysYesPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "extensions", CONFIG_DIR, ALWAYS_YES_FILE);
}

export function globalFoldersPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_DIR, FOLDERS_FILE);
}

export function projectFoldersPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "extensions", CONFIG_DIR, FOLDERS_FILE);
}

export function readLegacyConfig(): LegacyConfig {
	const path = configPath();
	if (!existsSync(path)) return { config: defaultConfig(), path, warnings: [] };

	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(raw)) {
			return {
				config: defaultConfig(),
				path,
				warnings: [`${path} must contain a JSON object; using the defaults`],
			};
		}

		const warnings: string[] = [];
		return { config: decodeConfig(raw, warnings), path, warnings };
	} catch (error) {
		return {
			config: defaultConfig(),
			path,
			warnings: [`could not parse ${path}: ${describe(error)}; using the defaults`],
		};
	}
}
