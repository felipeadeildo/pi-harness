import type {
	ExtensionAPI,
	ExtensionContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import type { Control, Json } from "../control.ts";
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
	/** The settings tab. Features with the same tab share it. Defaults to the id. */
	tab?: string;
	/** Section order on the tab. Sections not listed come after. A function runs when the screen opens. */
	sections?: readonly string[] | ((ctx: ExtensionContext | undefined) => readonly string[]);
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
	readonly screen: ScreenRows;
}

interface ScreenRow {
	id: string;
	section: string;
	label: string;
	description: string;
	/** How deep the row sits under its section. Each step indents two columns. */
	indent?: number;
}

export interface ScreenValue extends ScreenRow {
	control: Control | ((ctx: ExtensionContext) => Control);
	get(ctx: ExtensionContext): Json;
	/** Returns why the value was refused. */
	set(value: Json, ctx: ExtensionContext): string | undefined;
	/** Where the value applies, when that is not this session. */
	meta?: string;
	/** What the row shows in place of the value, like a count for a list. Undefined shows the value. */
	text?(ctx: ExtensionContext): string | undefined;
}

export interface ScreenAction extends ScreenRow {
	text?(ctx: ExtensionContext): string;
	confirm?: string;
	/** Returned text opens in the screen. A throw shows as an error. */
	run(ctx: ExtensionContext): string | undefined | Promise<string | undefined>;
}

export interface ScreenInfo extends ScreenRow {
	text(ctx: ExtensionContext): string;
}

export type ScreenEntry =
	| ({ kind: "value" } & ScreenValue)
	| ({ kind: "action" } & ScreenAction)
	| ({ kind: "info" } & ScreenInfo);

/** Rows a feature builds when the screen opens, for what is only known then. */
export type ScreenGroup = (ctx: ExtensionContext) => ScreenEntry[];

export interface ScreenRows {
	value(row: ScreenValue): void;
	action(row: ScreenAction): void;
	info(row: ScreenInfo): void;
	/** One call, many rows: the provider runs every time the screen opens. */
	rows(provider: ScreenGroup): void;
}

export function defineFeature(feature: Feature): Feature {
	return feature;
}
