// One store per app, reading only the settings its own features declared. A value comes from the
// first layer with a valid one: project (for settings that accept it, in a trusted project),
// global, default.
import { formatProblems } from "../decode.ts";
import { assign, lookup, readSettingsFile, type SettingsData, writeSettingsFile } from "./files.ts";
import type { Setting } from "./setting.ts";

type Found<T> = { found: true; value: T } | { found: false };

export class SettingsStore {
	readonly globalPath: string;
	#projectPath: string | undefined;
	#known = new Map<string, Setting<unknown>>();
	#values = new Map<string, unknown>();
	#listeners = new Map<string, Set<(value: unknown) => void>>();
	#loaded = false;

	constructor(globalPath: string) {
		this.globalPath = globalPath;
	}

	register(settings: readonly Setting<unknown>[]): void {
		for (const entry of settings) {
			const known = this.#known.get(entry.id);
			if (known !== undefined && known !== entry)
				throw new Error(`two settings are named "${entry.id}"`);
			this.#known.set(entry.id, entry);
		}
		this.#loaded = false;
	}

	/** Throws for a setting no feature declared, which would otherwise read its default forever. */
	get<T>(entry: Setting<T>): T {
		this.#assertKnown(entry);
		if (!this.#loaded) this.load(this.#projectPath);
		// Only `load` writes to #values, and always with a value this setting's decoder produced.
		return this.#values.has(entry.id) ? (this.#values.get(entry.id) as T) : entry.default;
	}

	listen<T>(entry: Setting<T>, listener: (value: T) => void): () => void {
		const listeners = this.#listeners.get(entry.id) ?? new Set();
		this.#listeners.set(entry.id, listeners);
		// Same reasoning as `get`: every value handed to a listener came from this setting's decoder.
		const untyped = listener as (value: unknown) => void;
		listeners.add(untyped);
		return () => listeners.delete(untyped);
	}

	/** Reads the files again. Pass the project file only when pi trusts the project. */
	load(projectPath?: string): string[] {
		this.#loaded = true;
		this.#projectPath = projectPath;
		const global = readSettingsFile(this.globalPath);
		const project = projectPath === undefined ? undefined : readSettingsFile(projectPath);
		const warnings = [...global.warnings, ...(project?.warnings ?? [])];

		for (const entry of this.#known.values()) {
			let value = entry.default;

			const fromGlobal = decodeAt(entry, global.data, this.globalPath, warnings);
			if (fromGlobal.found) value = fromGlobal.value;

			if (project !== undefined && projectPath !== undefined) {
				if (entry.project) {
					const fromProject = decodeAt(entry, project.data, projectPath, warnings);
					if (fromProject.found) value = fromProject.value;
				} else if (lookup(project.data, entry.id) !== undefined) {
					warnings.push(
						`${projectPath}: ${entry.id}: only the global settings file can set this; ignored`,
					);
				}
			}

			this.#update(entry, value);
		}

		return warnings;
	}

	/** Writes one value to the global file, keeping the rest. Returns an error message on failure. */
	set<T>(entry: Setting<T>, value: T): string | undefined {
		return this.setAll([[entry, value]]);
	}

	/**
	 * Writes several values in one pass, keeping the rest of the file. A value that already reads the
	 * same is not written, so the file ends up holding what was decided and not a copy of every
	 * default, which would freeze them.
	 */
	setAll(entries: readonly (readonly [Setting<unknown>, unknown])[]): string | undefined {
		for (const [entry] of entries) this.#assertKnown(entry);
		const changed = entries.filter(([entry, value]) => !same(this.get(entry), value));
		if (changed.length === 0) return undefined;

		const { data } = readSettingsFile(this.globalPath);
		for (const [entry, value] of changed) assign(data, entry.id, value);
		try {
			writeSettingsFile(this.globalPath, data);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		this.load(this.#projectPath);
		return undefined;
	}

	#assertKnown(entry: Setting<unknown>): void {
		if (this.#known.get(entry.id) !== entry)
			throw new Error(`the setting "${entry.id}" was not declared by any feature of this app`);
	}

	#update(entry: Setting<unknown>, value: unknown): void {
		const previous = this.#values.has(entry.id) ? this.#values.get(entry.id) : entry.default;
		this.#values.set(entry.id, value);
		if (same(previous, value)) return;
		for (const listener of this.#listeners.get(entry.id) ?? []) listener(value);
	}
}

function decodeAt<T>(
	entry: Setting<T>,
	data: SettingsData,
	path: string,
	warnings: string[],
): Found<T> {
	const input = lookup(data, entry.id);
	if (input === undefined) return { found: false };

	const result = entry.decoder.decode(input, entry.id);
	const suffix = result.ok ? "" : "; ignored";
	for (const line of formatProblems(result.problems)) warnings.push(`${path}: ${line}${suffix}`);
	return result.ok ? { found: true, value: result.value } : { found: false };
}

/** Decoders build new arrays and objects on every read, so two values are compared by content. */
function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
