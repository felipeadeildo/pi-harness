// A setting is declared next to the feature that reads it. The declaration is plain data plus two
// helpers, so one handle works against any app.
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
	/** Accept a value from the project's settings file, once pi trusts the project. */
	project?: boolean;
	ui?: SettingUi;
}

export interface SettingsScope {
	readonly settings: SettingsStore;
}

export interface Setting<T> extends SettingDefinition<T> {
	get(scope: SettingsScope): T;
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
