// A session that has no name yet draws one from the list the first time it starts, and the room
// calls it by that word from then on. The claim is a file, so a resumed session gets its word back
// even after a restart; a session that started before the list existed keeps the handle the tasks
// gave it, which `bySession` still reads.
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { Feature } from "../app/feature.ts";
import { NAMES } from "../contracts/names.ts";
import { TASKS } from "../contracts/tasks.ts";
import { logFrom } from "../events/log.ts";
import { HOST } from "../host.ts";
import { readPresence } from "../presence/index.ts";
import { drawWord } from "./claim.ts";
import { WORDS } from "./words.ts";

export interface NamesOptions {
	/** The folder of claims. Defaults to `<agent dir>/harness/names`. */
	dir?: string;
}

/**
 * The names feature. The folder is an option so a test can draw into a temporary one.
 */
export function names(options: NamesOptions = {}): Feature {
	return {
		id: "names",
		description: "Gives each session a word from the list, which the room calls it by",
		setup(scope) {
			let held: { handle: string } | undefined;
			NAMES.provide(scope, () => held);
			scope.onSessionStart((ctx) => {
				// An older session keeps the handle the tasks logged; drawing a new word would rename
				// it on upgrade. `bySession` falls back to that handle too.
				if (TASKS.current(scope)?.state.handle !== undefined) return;
				const session = ctx.sessionManager.getSessionId();
				const dir = options.dir ?? join(getAgentDir(), "harness", "names");
				const open = readPresence().filter((entry) => entry.host === HOST);
				const claim = drawWord(
					{
						dir,
						lives: (other) => open.some((entry) => entry.session === other),
					},
					WORDS,
					session,
					HOST,
				);
				if (claim === undefined) return;
				held = { handle: claim.word };
				NAMES.changed(scope, held);
				logFrom(ctx, scope.events, "session.named", { handle: claim.word });
			});
		},
	};
}
