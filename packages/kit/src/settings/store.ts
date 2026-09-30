// One store per app, reading only the settings its own features declared. A value comes from the
// first layer with a valid one: project (for settings that accept it, in a trusted project),
// global, default.
import { formatProblems } from "../decode.ts";
import {
	assign,
	lookup,
	readSettingsFile,
	remove,
	type SettingsData,
	writeSettingsFile,
} from "./files.ts";
import type { Setting } from "./setting.ts";

export type Layer = "default" | "global" | "project";

type Found<T> = { found: true; value: T } | { found: false };

interface Loaded {
	value: unknown;
	layer: Layer;
	global?: unknown;
}

export class SettingsStore {
	readonly globalPath: string;
	#projectPath: string | undefined;
	#known = new Map<string, Setting<unknown>>();
	#loaded = new Map<string, Loaded>();
	#listeners = new Map<string, Set<(value: unknown) => void>>();
	#writeListeners = new Set<() => void>();
	#fresh = false;

	constructor(globalPath: string) {
		this.globalPath = globalPath;
	}

	get projectPath(): string | undefined {
		return this.#projectPath;
	}

	register(settings: readonly Setting<unknown>[]): void {
		for (const entry of settings) {
			const known = this.#known.get(entry.id);
			if (known !== undefined && known !== entry)
				throw new Error(`two settings are named "${entry.id}"`);
			this.#known.set(entry.id, entry);
		}
		this.#fresh = false;
	}

	known(): Setting<unknown>[] {
		return [...this.#known.values()];
	}

	/** Throws for a setting no feature declared, which would otherwise read its default forever. */
	get<T>(entry: Setting<T>): T {
		// Only `load` fills #loaded, and always with a value this setting's decoder produced.
		return this.#read(entry).value as T;
	}

	layer(entry: Setting<unknown>): Layer {
		return this.#read(entry).layer;
	}

	hidden(entry: Setting<unknown>): unknown {
		return this.#read(entry).global;
	}

	listen<T>(entry: Setting<T>, listener: (value: T) => void): () => void {
		const listeners = this.#listeners.get(entry.id) ?? new Set();
		this.#listeners.set(entry.id, listeners);
		// Same reasoning as `get`: every value handed to a listener came from this setting's decoder.
		const untyped = listener as (value: unknown) => void;
		listeners.add(untyped);
		return () => listeners.delete(untyped);
	}

	/** Lets other stores on the same files read them again. */
	onWrite(listener: () => void): () => void {
		this.#writeListeners.add(listener);
		return () => this.#writeListeners.delete(listener);
	}

	/** Reads the files again. Pass the project file only when pi trusts the project. */
	load(projectPath?: string): string[] {
		this.#fresh = true;
		this.#projectPath = projectPath;
		const global = readSettingsFile(this.globalPath);
		const project = projectPath === undefined ? undefined : readSettingsFile(projectPath);
		const warnings = [...global.warnings, ...(project?.warnings ?? [])];

		for (const entry of this.#known.values()) {
			let loaded: Loaded = { value: entry.default, layer: "default" };

			const fromGlobal = decodeAt(entry, global.data, this.globalPath, warnings);
			if (fromGlobal.found) loaded = { value: fromGlobal.value, layer: "global" };

			if (project !== undefined && projectPath !== undefined) {
				if (entry.project) {
					const fromProject = decodeAt(entry, project.data, projectPath, warnings);
					if (fromProject.found)
						loaded = { value: fromProject.value, layer: "project", global: loaded.value };
				} else if (lookup(project.data, entry.id) !== undefined) {
					warnings.push(
						`${projectPath}: ${entry.id}: only the global settings file can set this; ignored`,
					);
				}
			}

			this.#update(entry, loaded);
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
		const changed = entries.filter(([entry, value]) => !same(this.#globalOf(entry), value));
		if (changed.length === 0) return undefined;

		return this.#edit(this.globalPath, (data) => {
			for (const [entry, value] of changed) assign(data, entry.id, value);
		});
	}

	unset(entry: Setting<unknown>, layer: Exclude<Layer, "default">): string | undefined {
		this.#assertKnown(entry);
		const path = layer === "global" ? this.globalPath : this.#projectPath;
		if (path === undefined) return "no trusted project to change";
		return this.#edit(path, (data) => remove(data, entry.id));
	}

	#edit(path: string, change: (data: SettingsData) => void): string | undefined {
		const { data } = readSettingsFile(path);
		change(data);
		try {
			writeSettingsFile(path, data);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		this.load(this.#projectPath);
		for (const listener of this.#writeListeners) listener();
		return undefined;
	}

	#globalOf(entry: Setting<unknown>): unknown {
		const loaded = this.#read(entry);
		return loaded.layer === "project" ? loaded.global : loaded.value;
	}

	#read(entry: Setting<unknown>): Loaded {
		this.#assertKnown(entry);
		if (!this.#fresh) this.load(this.#projectPath);
		return this.#loaded.get(entry.id) ?? { value: entry.default, layer: "default" };
	}

	#assertKnown(entry: Setting<unknown>): void {
		if (this.#known.get(entry.id) !== entry)
			throw new Error(`the setting "${entry.id}" was not declared by any feature of this app`);
	}

	#update(entry: Setting<unknown>, loaded: Loaded): void {
		const previous = this.#loaded.get(entry.id)?.value ?? entry.default;
		this.#loaded.set(entry.id, loaded);
		if (same(previous, loaded.value)) return;
		for (const listener of this.#listeners.get(entry.id) ?? []) listener(loaded.value);
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
