// One open session for a screen: the client connects when the screen mounts, draws the cache first,
// and stops when the screen goes. The client changes its session in place, so the screen is told to
// draw again by a count of the changes, not by a new object.
import {
	type Cache,
	type Client,
	type ClientSession,
	type ConnectionOptions,
	connect,
	type SessionKey,
} from "@adeildo/pi-remote-protocol/client";
import { useEffect, useState } from "react";

export interface SessionSource {
	cache: Cache;
	open: ConnectionOptions["open"];
	/** What to call this client in the log. The machine is the session's, until a device brings its own. */
	clientName?: string;
	/** Set when the page cannot open the socket at all, as a refused login leaves it. */
	why?: string;
}

/** What a screen gets: the session, and why it has none when something stopped it. */
export interface OpenSession {
	session: ClientSession | undefined;
	/** The connection itself, which is what a composer sends through and what its queue comes from. */
	client: Client | undefined;
	changes: number;
	why?: string;
}

/** The session as the client holds it, and how many changes it has seen, which keys a redraw. */
export function useSession(key: SessionKey, source: () => Promise<SessionSource>): OpenSession {
	const [opened, setOpened] = useState<OpenSession>({
		session: undefined,
		client: undefined,
		changes: 0,
	});
	const { machine, session } = key;
	useEffect(() => {
		let open = true;
		let stop: (() => void) | undefined;
		void source()
			.then((ready) => {
				if (!open) return;
				if (ready.why !== undefined) {
					setOpened({ session: undefined, client: undefined, changes: 0, why: ready.why });
					return;
				}
				const opened = openSession({ machine, session }, ready, (current) =>
					setOpened((before) => ({ ...before, session: current, changes: before.changes + 1 })),
				);
				stop = opened.stop;
				setOpened((before) => ({ ...before, client: opened.client }));
			})
			// A screen with nothing to draw and nothing to say is a blank page, so a failure to even ask
			// is a sentence too.
			.catch(() =>
				setOpened({
					session: undefined,
					client: undefined,
					changes: 0,
					why: "The session could not be opened. Ask for a new link with /remote.",
				}),
			);
		return () => {
			open = false;
			stop?.();
		};
	}, [machine, session, source]);
	return opened;
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
): { client: Client; stop: () => void } {
	// The identity is the client's, not the session's: a phone looking at a desktop session is still the
	// phone, so the name is the device's and not the session's. The machine is the one the address
	// names, which is the pi's, because a page cannot know its own host. What the log needs is that a
	// command has an author at all, and the name is the part this side can carry.
	const client = connect({
		key,
		cache: source.cache,
		open: source.open,
		by: { kind: "client", name: source.clientName ?? "browser", machine: key.machine },
	});
	let open = true;
	const stop = client.on(changed);
	void client.load().then(() => {
		if (open) changed(client.session());
	});
	return {
		client,
		stop: () => {
			open = false;
			stop();
			client.stop();
		},
	};
}
