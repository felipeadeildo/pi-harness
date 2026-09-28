import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { SettingsStore } from "../settings/store.ts";
import { attributed } from "./attribution.ts";
import type { FeatureScope, SessionHook, ShutdownHook } from "./feature.ts";

export interface Hook<T> {
	source: string;
	run: T;
}

/** The parts of an app a feature scope reads and writes. */
export interface AppState {
	name: string;
	pi: ExtensionAPI;
	settings: SettingsStore;
	mounted: ReadonlySet<string>;
	commands: Map<string, string>;
	starts: Hook<SessionHook>[];
	shutdowns: Hook<ShutdownHook>[];
	report(source: string, message: string): void;
}

export function createScope(app: AppState, featureId: string): FeatureScope {
	const label = `${app.name}: ${featureId}`;

	const scope: FeatureScope = {
		id: featureId,
		pi: app.pi,
		settings: app.settings,
		on: attributedOn(app.pi, label),
		registerCommand(name, options) {
			const owner = app.commands.get(name);
			if (owner !== undefined) {
				scope.warn(`/${name} is already registered by ${owner}; skipped`);
				return;
			}
			app.commands.set(name, featureId);
			app.pi.registerCommand(name, {
				...options,
				handler: attributed(`${label}: /${name}`, options.handler),
			});
		},
		onSessionStart: (run) => app.starts.push({ source: featureId, run }),
		onShutdown: (run) => app.shutdowns.push({ source: featureId, run }),
		warn: (message) => app.report(featureId, message),
		has: (id) => app.mounted.has(id),
	};

	return scope;
}

type UntypedHandler = (...args: unknown[]) => unknown;
type UntypedOn = (event: string, handler: UntypedHandler) => () => void;

// pi.on has one overload per event and TypeScript cannot implement an overloaded signature
// generically, so this is the one place that casts. Callers keep the exact overload types.
function attributedOn(pi: ExtensionAPI, label: string): ExtensionAPI["on"] {
	const on = pi.on.bind(pi) as unknown as UntypedOn;
	const wrapped: UntypedOn = (event, handler) =>
		on(event, attributed(`${label}: ${event}`, handler));
	return wrapped as unknown as ExtensionAPI["on"];
}
