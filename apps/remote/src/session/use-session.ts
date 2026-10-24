// One open session for a screen: the client connects when the screen mounts, draws the cache first,
// and stops when the screen goes. The client changes its session in place, so the screen is told to
// draw again by a count of the changes, not by a new object.
import {
	type Cache,
	type ClientSession,
	type ConnectionOptions,
	connect,
	type SessionKey,
} from "@adeildo/pi-remote-client";
import { useEffect, useState } from "react";

export interface SessionSource {
	cache: Cache;
	open: ConnectionOptions["open"];
}

/**
 * The session as the client holds it, and how many changes it has seen, which keys a redraw. The
 * source is asked for only once the screen is in a browser: the static export renders the route on
 * a server, where there is no storage and no socket.
 */
export function useSession(
	key: SessionKey,
	source: () => SessionSource,
): { session: ClientSession | undefined; changes: number } {
	const [held, setHeld] = useState<{ session: ClientSession | undefined; changes: number }>({
		session: undefined,
		changes: 0,
	});
	const { machine, session } = key;
	useEffect(
		() =>
			openSession({ machine, session }, source(), (current) =>
				setHeld((before) => ({ session: current, changes: before.changes + 1 })),
			),
		[machine, session, source],
	);
	return held;
}

/**
 * Connects to one session and tells `changed` about it: once the cache is read, even when it held
 * nothing, so a cold open shows the frame of the screen while the daemon answers, and after each
 * change. What it returns ends the connection and stops the telling, which is a screen's unmount.
 */
export function openSession(
	key: SessionKey,
	source: SessionSource,
	changed: (session: ClientSession) => void,
): () => void {
	const client = connect({ key, cache: source.cache, open: source.open });
	let open = true;
	const stop = client.on(changed);
	void client.load().then(() => {
		if (open) changed(client.session());
	});
	return () => {
		open = false;
		stop();
		client.stop();
	};
}
