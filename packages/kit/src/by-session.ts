// Which session caused a fact, as its `by`. Every caller asks here, so the day sessions draw their
// handles from the names list only this file changes.
import type { EventScope } from "./contract.ts";
import type { By } from "./contracts/by.ts";
import { TASKS } from "./contracts/tasks.ts";
import { HOST } from "./host.ts";

/**
 * A session as the `by` of what happens in it. The name is the handle the tasks feature gave the
 * session, which is what the room calls it, or `new-` and the last four characters of the id while it
 * has none, as peers shows an untitled session. Never the title: it changes with the work, and the
 * name of a fact must not.
 */
export function bySession(
	kind: By["kind"],
	scope: EventScope,
	session: { getSessionId(): string },
	machine: string = HOST,
): By {
	const handle = TASKS.current(scope)?.state.handle;
	const name = handle ?? `new-${session.getSessionId().slice(-4)}`;
	return { kind, name, machine };
}
