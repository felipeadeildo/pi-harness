import type {
	ExtensionAPI,
	ExtensionContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import type { EventScope } from "../events.ts";
import type { Setting, SettingsScope } from "../settings/setting.ts";
import type { SettingsStore } from "../settings/store.ts";

export type SessionHook = (ctx: ExtensionContext) => void | Promise<void>;
export type ShutdownHook = () => void | Promise<void>;
export type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

export interface Feature {
	/** Unique across every package, like `subscription`. It names the feature's settings too. */
	id: string;
	/** One line for the settings screen. */
	description: string;
	settings?: readonly Setting<unknown>[];
	/** Registers handlers, commands and providers. Starts nothing: that goes in `onSessionStart`. */
	setup(scope: FeatureScope): void;
}

export interface FeatureScope extends SettingsScope, EventScope {
	/** The feature's id. */
	readonly id: string;
	/** For whatever the scope does not wrap, without the feature's name on errors. */
	readonly pi: ExtensionAPI;
	readonly settings: SettingsStore;
	/** `pi.on`, with the feature's name on every error. Errors are rethrown, never swallowed. */
	readonly on: ExtensionAPI["on"];
	registerCommand(name: string, options: CommandOptions): void;
	onSessionStart(hook: SessionHook): void;
	onShutdown(hook: ShutdownHook): void;
	warn(message: string): void;
	has(featureId: string): boolean;
}

export function defineFeature(feature: Feature): Feature {
	return feature;
}
