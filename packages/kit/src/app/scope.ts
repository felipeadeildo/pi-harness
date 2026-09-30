import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { SettingsStore } from "../settings/store.ts";
import { attributed } from "./attribution.ts";
import type { FeatureScope, ScreenEntry, SessionHook, ShutdownHook } from "./feature.ts";

export interface Hook<T> {
	/** The feature that registered it, named when it fails. */
	source: string;
	run: T;
}

/** The parts of an app a feature scope reads and writes. */
export interface AppState {
	name: string;
	pi: ExtensionAPI;
	settings: SettingsStore;
	mounted: ReadonlySet<string>;
	/** Command name to the feature that registered it. */
	commands: Map<string, string>;
	starts: Hook<SessionHook>[];
	shutdowns: Hook<ShutdownHook>[];
	screen: Map<string, ScreenEntry[]>;
	report(source: string, message: string): void;
}

export function createScope(state: AppState, featureId: string): FeatureScope {
	const label = `${state.name}: ${featureId}`;
	const rows: ScreenEntry[] = state.screen.get(featureId) ?? [];
	state.screen.set(featureId, rows);
	const add = (row: ScreenEntry): void => {
		if (rows.some((entry) => entry.id === row.id)) {
			state.report(featureId, `the screen row "${row.id}" was added twice; keeping the first`);
			return;
		}
		rows.push(row);
	};

	return {
		...state.pi,
		id: featureId,
		settings: state.settings,
		on: attributedOn(state.pi, label),
		registerCommand(name, options) {
			const owner = state.commands.get(name);
			if (owner !== undefined) {
				state.report(featureId, `/${name} is already registered by ${owner}; skipped`);
				return;
			}
			state.commands.set(name, featureId);
			state.pi.registerCommand(name, {
				...options,
				handler: attributed(`${label}: /${name}`, options.handler),
			});
		},
		onSessionStart: (run) => state.starts.push({ source: featureId, run }),
		onShutdown: (run) => state.shutdowns.push({ source: featureId, run }),
		warn: (message) => state.report(featureId, message),
		has: (id) => state.mounted.has(id),
		screen: {
			value: (row) => add({ kind: "value", ...row }),
			action: (row) => add({ kind: "action", ...row }),
			info: (row) => add({ kind: "info", ...row }),
		},
	} as FeatureScope;
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
