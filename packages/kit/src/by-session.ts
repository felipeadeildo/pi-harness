// Which session caused a state change, as its `by`. Every caller asks here, so the day sessions draw their
// handles from the names list only this file changes.
import type { EventScope } from "./contract.ts";
import type { By } from "./contracts/by.ts";
import { NAMES } from "./contracts/names.ts";
import { TASKS } from "./contracts/tasks.ts";
import { HOST } from "./host.ts";

/**
 * The handle the room calls the session by: the word the names feature drew from the list, or the
 * handle the tasks logged before the list existed, and `undefined` while it has none. Never the
 * title: it changes with the work, and a name must not. Every reader of the handle asks here, so the
 * order between the two sources lives in one place.
 *
 * The tasks' handle is a copy from when the session started, and it answers until a rename arrives.
 * When `names.rename` lands, either the tasks learn to follow it or this fallback goes: otherwise a
 * renamed session would answer with the old word once its `NAMES` value is rebuilt from the log.
 */
export function handleOf(scope: EventScope): string | undefined {
	return NAMES.current(scope)?.handle ?? TASKS.current(scope)?.state.handle;
}

/**
 * A session as the `by` of what happens in it. The name is `handleOf`, or `new-` and the last four
 * characters of the id while it has none, as peers shows an untitled session. A client is named by
 * its device, which a session cannot know, so a client builds its own `By`.
 */
export function bySession(
	kind: Exclude<By["kind"], "client">,
	scope: EventScope,
	session: { getSessionId(): string },
	options: { machine?: string } = {},
): By {
	const handle = handleOf(scope);
	const name = handle ?? `new-${session.getSessionId().slice(-4)}`;
	return { kind, name, machine: options.machine ?? HOST };
}
