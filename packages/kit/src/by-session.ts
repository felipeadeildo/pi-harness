// Which session caused a state change, as its `by`. Every caller asks here, so the day sessions draw their
// handles from the names list only this file changes.
import type { EventScope } from "./contract.ts";
import type { By } from "./contracts/by.ts";
import { NAMES } from "./contracts/names.ts";
import { HOST } from "./host.ts";

/**
 * The handle the room calls the session by, which the names feature holds, and `undefined` while it
 * has none. Every reader of the handle asks here.
 */
export function handleOf(scope: EventScope): string | undefined {
	return NAMES.current(scope)?.handle;
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
