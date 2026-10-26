// The last list the daemon gave, kept for the screen that opens one of its sessions: the row already
// knows its name and folder while the session's own opening is still on the way.
import type { ListedSession } from "@adeildo/pi-remote-protocol/client";

let last: readonly ListedSession[] = [];

export function rememberListed(sessions: readonly ListedSession[]): void {
	last = sessions;
}

export function listedOf(machine: string, session: string): ListedSession | undefined {
	return last.find((one) => one.machine === machine && one.session === session);
}
