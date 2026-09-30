// Two keys for what a session changes the most. Everything else is on the settings screen.
import type { FeatureScope } from "@adeildo/pi-kit";
import { Key } from "@earendil-works/pi-tui";

import { nextMode, PERMISSION_MODES } from "#core/mode.ts";
import { toggleOutside } from "#core/workspace.ts";
import { NAME } from "#identity";
import { setSessionMode, setSessionOutside } from "#pi/mode.ts";
import type { SessionState } from "#pi/session.ts";

export function registerShortcuts(scope: FeatureScope, state: SessionState): void {
	scope.registerShortcut(Key.alt("m"), {
		description: `${NAME}: cycle mode (${PERMISSION_MODES.join(", ")})`,
		handler: (ctx) => setSessionMode(scope, state, nextMode(state.mode), ctx),
	});

	scope.registerShortcut(Key.alt("w"), {
		description: `${NAME}: ask or allow calls outside the workspace, this session`,
		handler: (ctx) => setSessionOutside(scope, state, toggleOutside(state.outside), ctx),
	});
}
