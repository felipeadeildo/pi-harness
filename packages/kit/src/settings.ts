// Settings are declared next to the feature that reads them, the way oh-my-pi does it,
// and every app keeps its values in one store. The harness and standalone packages share
// one file, so a store only reads and warns about the settings its own features declared,
// and a write keeps every key it does not know.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { type Decoder, formatProblems, isObject } from "./decode.ts";

/** How a setting shows up on a settings screen. */
export interface SettingUi {
	group: string;
	label: string;
	description: string;
}

export interface SettingDefinition<T> {
	/** Dotted path in the settings file, like `subscription.claudeCodeVersion`. */
	id: string;
	default: T;
	decoder: Decoder<T>;
	ui?: SettingUi;
}

/** Anything that carries a settings store. An app does. */
export interface SettingsScope {
	readonly settings: SettingsStore;
}

export interface Setting<T> extends SettingDefinition<T> {
	get(scope: SettingsScope): T;
	/** Called with the new value whenever a load or a write changes it. */
	listen(scope: SettingsScope, listener: (value: T) => void): () => void;
}

export function setting<T>(definition: SettingDefinition<T>): Setting<T> {
	const handle: Setting<T> = {
		...definition,
		get: (scope) => scope.settings.get(handle),
		listen: (scope, listener) => scope.settings.listen(handle, listener),
	};
	return handle;
}

export class SettingsStore {
	readonly path: string;
	#known = new Map<string, Setting<unknown>>();
	#values = new Map<string, unknown>();
	#listeners = new Map<string, Set<(value: unknown) => void>>();
	#loaded = false;

	constructor(path: string) {
		this.path = path;
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

	get<T>(entry: Setting<T>): T {
		if (!this.#loaded) this.load();
		// Only `load` and `set` write to #values, both with a value this setting's decoder produced.
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

	/** Reads the file again. Returns what was wrong with it, one line per problem. */
	load(): string[] {
		this.#loaded = true;
		const { raw, warnings } = readSettingsFile(this.path);

		for (const entry of this.#known.values()) {
			const input = lookup(raw, entry.id);
			let value = entry.default;
			if (input !== undefined) {
				const result = entry.decoder.decode(input, entry.id);
				if (result.ok) value = result.value;
				for (const line of formatProblems(result.problems)) {
					warnings.push(`${line}${result.ok ? "" : "; using the default"}`);
				}
			}
			this.#update(entry, value);
		}

		return warnings.map((line) => `${this.path}: ${line}`);
	}

	/** Writes one value and keeps the rest of the file. Returns an error message on failure. */
	set<T>(entry: Setting<T>, value: T): string | undefined {
		const { raw } = readSettingsFile(this.path);
		assign(raw, entry.id, value);
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.${process.pid}.tmp`;
			writeFileSync(temporary, `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
			renameSync(temporary, this.path);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		this.#update(entry, value);
		return undefined;
	}

	#update(entry: Setting<unknown>, value: unknown): void {
		const previous = this.#values.has(entry.id) ? this.#values.get(entry.id) : entry.default;
		this.#values.set(entry.id, value);
		// Decoders build new arrays and objects on every load, so compare by content.
		if (JSON.stringify(previous) === JSON.stringify(value)) return;
		for (const listener of this.#listeners.get(entry.id) ?? []) listener(value);
	}
}

function readSettingsFile(path: string): { raw: Record<string, unknown>; warnings: string[] } {
	if (!existsSync(path)) return { raw: {}, warnings: [] };
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isObject(raw)) return { raw, warnings: [] };
		return { raw: {}, warnings: ["must contain a JSON object; using the defaults"] };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { raw: {}, warnings: [`could not be read (${reason}); using the defaults`] };
	}
}

function lookup(raw: Record<string, unknown>, id: string): unknown {
	let node: unknown = raw;
	for (const key of id.split(".")) {
		if (!isObject(node)) return undefined;
		node = node[key];
	}
	return node;
}

function assign(raw: Record<string, unknown>, id: string, value: unknown): void {
	const keys = id.split(".");
	const last = keys.pop();
	if (last === undefined) return;
	let node = raw;
	for (const key of keys) {
		const next = node[key];
		if (isObject(next)) node = next;
		else {
			const created: Record<string, unknown> = {};
			node[key] = created;
			node = created;
		}
	}
	node[last] = value;
}
