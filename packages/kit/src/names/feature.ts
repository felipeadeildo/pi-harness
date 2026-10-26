// A session that has no name yet draws one from the list the first time it starts, and the room
// calls it by that word from then on. The claim is a file, so a resumed session gets its word back
// even after a restart; a session that started before the list existed keeps the handle the tasks
// wrote in its file.
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { Feature } from "../app/feature.ts";
import { NAMES } from "../contracts/names.ts";
import { logFrom } from "../events/log.ts";
import { HOST } from "../host.ts";
import { tasksHandleOf } from "../legacy-tasks.ts";
import { readPresence } from "../presence/index.ts";
import { claimWord, drawWord } from "./claim.ts";
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
				const session = ctx.sessionManager.getSessionId();
				const dir = options.dir ?? join(getAgentDir(), "harness", "names");
				// An older session keeps the handle the tasks wrote in its file, and claims it in the names
				// folder like any other word.
				const previous = tasksHandleOf(ctx.sessionManager.getBranch());
				if (previous !== undefined) {
					held = { handle: previous };
					NAMES.changed(scope, held);
					if (claimWord({ dir }, previous, session, HOST)) {
						logFrom(ctx, scope.events, "session.named", { handle: previous });
					}
					return;
				}
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
