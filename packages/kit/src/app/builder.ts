// The app builder. A package's extension is `createApp(pi, …).use(feature).build()`, and the
// harness is the same call with every feature, so they run in one extension and share one
// settings store. The builder is where the rules from pi's extension docs live, so a feature does
// not have to remember them. Nothing but registration happens in the factory. Session work starts
// from `session_start`, cleanup runs once per session, and a feature that fails to set up becomes
// a warning instead of taking the rest of the app down.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { boolean } from "../decode.ts";
import { globalSettingsPath, projectSettingsPath } from "../settings/files.ts";
import { type Setting, type SettingsScope, setting } from "../settings/setting.ts";
import { SettingsStore } from "../settings/store.ts";
import { describe } from "./attribution.ts";
import { answerClaims, ownerOf } from "./claim.ts";
import type { Feature } from "./feature.ts";
import { type AppState, createScope, type Hook } from "./scope.ts";

export interface App extends SettingsScope {
	/** Shown in front of every warning, like `pi-harness` or `pi-providers`. */
	readonly name: string;
	readonly settings: SettingsStore;
	/** True when this app runs a feature with that id. */
	has(featureId: string): boolean;
}

export interface AppOptions {
	name: string;
	/** The global settings file. Defaults to the one every app shares. */
	settingsPath?: string;
}

export interface AppBuilder {
	use(feature: Feature): AppBuilder;
	build(): App;
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

/** `features.<id>.enabled`. A feature that is off never gets set up, so it costs nothing. */
export function enabledSetting(feature: Feature): Setting<boolean> {
	return setting({
		id: `features.${feature.id}.enabled`,
		default: true,
		decoder: boolean,
		ui: { group: "Features", label: feature.id, description: feature.description },
	});
}

function mount(pi: ExtensionAPI, options: AppOptions, features: readonly Feature[]): App {
	const settings = new SettingsStore(options.settingsPath ?? globalSettingsPath());
	const mounted = new Set<string>();
	const queued: string[] = [];
	let session: ExtensionContext | undefined;
	let live = true;

	function deliver(line: string): void {
		if (session === undefined) queued.push(line);
		else if (session.hasUI) session.ui.notify(line, "warning");
		else console.error(line);
	}

	const state: AppState = {
		name: options.name,
		pi,
		settings,
		mounted,
		commands: new Map(),
		starts: [],
		shutdowns: [],
		report: (source, message) => deliver(`${options.name}: ${source}: ${message}`),
	};
	const app: App = { name: options.name, settings, has: (id) => mounted.has(id) };

	answerClaims(pi, options.name, mounted, () => live);

	// Registered before any feature's setup, so these run ahead of the features' own handlers.
	pi.on("session_start", async (_event, ctx) => {
		live = true;
		session = ctx;
		for (const line of queued.splice(0)) deliver(line);
		const project = ctx.isProjectTrusted() ? projectSettingsPath(ctx.cwd) : undefined;
		for (const line of settings.load(project)) state.report("settings", line);
		await runInOrder(
			state.starts,
			(run) => run(ctx),
			(source, error) => {
				state.report(source, `failed to start the session: ${describe(error)}`);
			},
		);
	});

	pi.on("session_shutdown", async () => {
		if (!live) return;
		live = false;
		await runInOrder(
			state.shutdowns.toReversed(),
			(run) => run(),
			(source, error) => {
				state.report(source, `failed to shut down: ${describe(error)}`);
			},
		);
		session = undefined;
	});

	// Every feature's settings are registered first, so the file is read once to learn which ones
	// are on, and a feature that is off still shows up on the settings screen.
	const candidates: { feature: Feature; enabled: Setting<boolean> }[] = [];
	for (const feature of features) {
		if (candidates.some((candidate) => candidate.feature.id === feature.id)) {
			state.report(feature.id, "was added to this app twice; keeping the first");
			continue;
		}
		const enabled = enabledSetting(feature);
		try {
			settings.register([enabled, ...(feature.settings ?? [])]);
			candidates.push({ feature, enabled });
		} catch (error) {
			state.report(feature.id, `failed to set up: ${describe(error)}`);
		}
	}

	for (const { feature, enabled } of candidates) {
		if (!enabled.get(app)) continue;

		const owner = ownerOf(pi, feature.id);
		if (owner !== undefined) {
			state.report(feature.id, `already loaded by ${owner}, so this copy stays off`);
			continue;
		}

		try {
			feature.setup(createScope(state, feature.id));
			mounted.add(feature.id);
		} catch (error) {
			// Whatever the feature registered before it threw stays registered. pi has no undo.
			state.report(feature.id, `failed to set up: ${describe(error)}`);
		}
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
