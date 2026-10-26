// The last list the daemon gave, kept for the screen that opens one of its sessions: the row already
// knows its name and folder while the session's own opening is still on the way.
import type { ListedSession } from "@adeildo/pi-remote-protocol/client";

import type { Mentionable } from "./suggestions.ts";

let last: readonly ListedSession[] = [];

export function rememberListed(sessions: readonly ListedSession[]): void {
	last = sessions;
}

export function listedOf(machine: string, session: string): ListedSession | undefined {
	return last.find((one) => one.machine === machine && one.session === session);
}

/** The agents a mention from this session reaches: the others open in its folder. */
export function agentsNear(machine: string, session: string): Mentionable[] {
	const me = listedOf(machine, session);
	const cwd = me?.summary?.cwd ?? me?.live.cwd;
	return last
		.filter(
			(one) => one.gone === undefined && !(one.machine === machine && one.session === session),
		)
		.filter((one) => cwd === undefined || (one.summary?.cwd ?? one.live.cwd) === cwd)
		.flatMap((one) => {
			const handle = one.summary?.handle;
			if (handle === undefined) return [];
			const name = one.state.name ?? one.summary?.name;
			return [{ handle, ...(name === undefined ? {} : { name }) }];
		});
}
