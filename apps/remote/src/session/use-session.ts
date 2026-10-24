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
	useEffect(() => {
		const { cache, open } = source();
		const client = connect({ key: { machine, session }, cache, open });
		const stop = client.on((current) =>
			setHeld((before) => ({ session: current, changes: before.changes + 1 })),
		);
		// Drawn once the cache is read, even when it held nothing, so a cold open shows the frame of the
		// screen instead of nothing while the daemon answers.
		void client
			.load()
			.then(() =>
				setHeld((before) => ({ session: client.session(), changes: before.changes + 1 })),
			);
		return () => {
			stop();
			client.stop();
		};
	}, [machine, session, source]);
	return held;
}
