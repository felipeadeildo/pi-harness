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

/** What a feature gets in `setup`. Everything it registers through here carries its name. */
export interface FeatureScope extends SettingsScope, EventScope {
	/** The feature's id. */
	readonly id: string;
	/** For whatever the scope does not wrap. What it registers is not attributed to the feature. */
	readonly pi: ExtensionAPI;
	readonly settings: SettingsStore;
	/**
	 * `pi.on` with the feature's name on every error. Errors are rethrown, not swallowed: a
	 * `tool_call` handler that throws is how pi blocks a tool.
	 */
	readonly on: ExtensionAPI["on"];
	/** `pi.registerCommand`, except a name another feature of this app took is skipped with a warning. */
	registerCommand(name: string, options: CommandOptions): void;
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
