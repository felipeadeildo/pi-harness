import type {
	ExtensionAPI,
	ExtensionContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

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

/**
 * What a feature gets in `setup`: the extension API, with `on` and `registerCommand` wired to this
 * feature, plus the app's services. It extends `ExtensionAPI` on purpose. Reading a method through
 * another type collapses pi's per-event overloads, and extending an interface keeps them.
 */
export interface FeatureScope extends ExtensionAPI, SettingsScope {
	readonly id: string;
	readonly settings: SettingsStore;
	/** Runs when a session starts, after the settings are loaded for it. */
	onSessionStart(hook: SessionHook): void;
	/** Runs once per session, newest first. */
	onShutdown(hook: ShutdownHook): void;
	/** Shown as `<app>: <feature>: <message>`. */
	warn(message: string): void;
	/** True when this app runs a feature with that id. */
	has(featureId: string): boolean;
}

export function defineFeature(feature: Feature): Feature {
	return feature;
}
