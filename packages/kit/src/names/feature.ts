// A session draws a handle the first time it starts and keeps it, across restarts too. Sessions
// from before the list keep the handle their tasks wrote.
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
	dir?: string;
}

export function names(options: NamesOptions = {}): Feature {
	return {
		id: "names",
		description: "Gives each session a word from the list, which the room calls it by",
		setup(scope) {
			let held: { handle: string } | undefined;
			NAMES.provide(scope, () => held);
			// The model cannot read the footer, so it learns its handle here.
			scope.on("before_agent_start", (event) => {
				if (held === undefined) return;
				event.systemPromptOptions.sections.handle = handleSection(held.handle);
			});
			scope.onSessionStart((ctx) => {
				const session = ctx.sessionManager.getSessionId();
				const dir = options.dir ?? join(getAgentDir(), "harness", "names");
				// An older session claims the handle its tasks wrote, like any other word.
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

export function handleSection(handle: string): string {
	return `Your handle in this session is ${handle}. The operator and the other agents call you by it, and it is the name to sign with where your work names its author.`;
}
