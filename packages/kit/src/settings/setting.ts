// A setting is declared next to the feature that reads it, the way oh-my-pi does it. The
// declaration is plain data plus two helpers, so the same handle works against any app.
import type { Decoder } from "../decode.ts";
import type { SettingsStore } from "./store.ts";

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
	/**
	 * Accept a value from the project's settings file once pi trusts the project. Off unless set,
	 * so a cloned repository cannot change anything that decides what runs without asking.
	 */
	project?: boolean;
	ui?: SettingUi;
}

/** Anything that carries a settings store. An app and a feature scope both do. */
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
