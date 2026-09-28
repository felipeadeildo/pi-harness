// The app builder. A package's extension is `createApp(pi, …).use(feature).build()`, and the
// harness is the same call with every feature, so they run in one extension and share one
// settings store. The builder is where the rules from pi's extension docs live, so a feature
// does not have to remember them: nothing but registration happens in the factory, session
// work starts from `session_start`, cleanup runs once per session, and a feature that fails
// to set up becomes a warning instead of taking the rest of the app down.
import { join } from "node:path";

import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { isObject, object, string } from "./decode.ts";
import type { EventScope } from "./events.ts";
import { type Setting, type SettingsScope, SettingsStore } from "./settings.ts";

export interface Feature {
	/** Stable and unique across every package, like `subscription`. */
	id: string;
	settings?: readonly Setting<unknown>[];
	/** Registers handlers, commands, tools, providers. Starts nothing. */
	setup(app: App): void;
}

export interface App extends SettingsScope, EventScope {
	/** Shown in front of warnings, like `pi-harness` or `pi-providers`. */
	readonly name: string;
	readonly pi: ExtensionAPI;
	readonly settings: SettingsStore;
	/** True when this app mounted the feature. */
	has(featureId: string): boolean;
	/** A notification when a session with UI is up, stderr without UI, queued before a session. */
	warn(source: string, message: string): void;
	/** Runs after the settings are loaded for the session. */
	onSessionStart(hook: (ctx: ExtensionContext) => void | Promise<void>): void;
	/** Runs once per session, in reverse order of registration. */
	onShutdown(hook: () => void | Promise<void>): void;
}

export interface AppOptions {
	name: string;
	/** Defaults to {@link defaultSettingsPath}, the file every app shares. */
	settingsPath?: string;
}

export interface AppBuilder {
	use(feature: Feature): AppBuilder;
	build(): App;
}

export function defineFeature(feature: Feature): Feature {
	return feature;
}

export function defaultSettingsPath(): string {
	return join(getAgentDir(), "extensions", "pi-harness", "settings.json");
}

export function createApp(pi: ExtensionAPI, options: AppOptions): AppBuilder {
	const features: Feature[] = [];
	const builder: AppBuilder = {
		use(feature) {
			features.push(feature);
			return builder;
		},
		build: () => mount(pi, options, features),
	};
	return builder;
}

// Before mounting a feature, an app asks every other app on pi.events whether one already
// has it. That is how the harness and a standalone copy of the same package avoid running a
// feature twice. The reply is a field written on the payload, which works because pi's event
// bus calls listeners synchronously. An app answers only while its runtime is live, and pi
// fires `session_shutdown` before a reload builds the next runtime.
const CLAIM = "harness:kit:claim";
const claimShape = object({ feature: string });

interface Hook<T> {
	source: string;
	run: T;
}

function mount(pi: ExtensionAPI, options: AppOptions, features: readonly Feature[]): App {
	const settings = new SettingsStore(options.settingsPath ?? defaultSettingsPath());
	const mounted = new Set<string>();
	const starts: Hook<(ctx: ExtensionContext) => void | Promise<void>>[] = [];
	const shutdowns: Hook<() => void | Promise<void>>[] = [];
	const queued: string[] = [];
	let session: ExtensionContext | undefined;
	let live = true;
	// Whose setup is running, so a hook knows which feature to blame when it fails.
	let registering = options.name;

	function report(line: string): void {
		if (session === undefined) queued.push(line);
		else if (session.hasUI) session.ui.notify(line, "warning");
		else console.error(line);
	}

	const app: App = {
		name: options.name,
		pi,
		settings,
		has: (featureId) => mounted.has(featureId),
		warn: (source, message) => report(`${options.name}: ${source}: ${message}`),
		onSessionStart: (run) => starts.push({ source: registering, run }),
		onShutdown: (run) => shutdowns.push({ source: registering, run }),
	};

	pi.events.on(CLAIM, (data) => {
		const claim = claimShape.decode(data, "");
		if (!live || !claim.ok || !isObject(data) || data.owner !== undefined) return;
		if (mounted.has(claim.value.feature)) data.owner = options.name;
	});

	// Registered before any feature's setup, so these run ahead of the features' own handlers.
	pi.on("session_start", async (_event, ctx) => {
		live = true;
		session = ctx;
		for (const line of queued.splice(0)) report(line);
		for (const line of settings.load()) app.warn("settings", line);
		await runInOrder(
			starts,
			(run) => run(ctx),
			(source, error) => app.warn(source, `failed to start the session: ${describe(error)}`),
		);
	});

	pi.on("session_shutdown", async () => {
		if (!live) return;
		live = false;
		await runInOrder(
			shutdowns.toReversed(),
			(run) => run(),
			(source, error) => app.warn(source, `failed to shut down: ${describe(error)}`),
		);
		session = undefined;
	});

	for (const feature of features) {
		if (mounted.has(feature.id)) {
			app.warn(feature.id, "was added to this app twice; keeping the first");
			continue;
		}

		const claim: { feature: string; owner?: unknown } = { feature: feature.id };
		pi.events.emit(CLAIM, claim);
		if (typeof claim.owner === "string") {
			app.warn(feature.id, `already loaded by ${claim.owner}, so this copy stays off`);
			continue;
		}

		registering = feature.id;
		try {
			settings.register(feature.settings ?? []);
			feature.setup(app);
			mounted.add(feature.id);
		} catch (error) {
			// Whatever the feature registered before it threw stays registered; pi has no undo.
			app.warn(feature.id, `failed to set up: ${describe(error)}`);
		}
		registering = options.name;
	}

	return app;
}

/** One at a time, so a hook can count on the ones before it having finished. */
async function runInOrder<T>(
	hooks: readonly Hook<T>[],
	call: (run: T) => void | Promise<void>,
	failed: (source: string, error: unknown) => void,
): Promise<void> {
	for (const hook of hooks) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- the order is the point
			await call(hook.run);
		} catch (error) {
			failed(hook.source, error);
		}
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
