// Which session caused a state change, as its `by`. Every caller asks here, so the day sessions draw their
// handles from the names list only this file changes.
import type { EventScope } from "./contract.ts";
import type { By } from "./contracts/by.ts";
import { NAMES } from "./contracts/names.ts";
import { HOST } from "./host.ts";

export function handleOf(scope: EventScope): string | undefined {
	return NAMES.current(scope)?.handle;
}

/** Named by the handle, or `new-` and the id's last four characters until it has one. */
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
