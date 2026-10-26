// The client changes its session in place, so the screen redraws on a change count.
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
	/** May be on another machine than the page's. */
	open: (key: SessionKey) => ConnectionOptions["open"];
	/** The machine is the session's until a device brings its own. */
	clientName?: string;
	/** Set when the socket cannot open at all, as after a refused login. */
	why?: string;
}

export interface OpenSession {
	session: ClientSession | undefined;
	client: Client | undefined;
	changes: number;
	why?: string;
}

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
			// A failure to even ask is a sentence too, not a blank page.
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

/** Calls `changed` once the cache is read, even when empty, then after each change. */
export function openSession(
	key: SessionKey,
	source: SessionSource,
	changed: (session: ClientSession) => void,
): { client: Client; stop: () => void } {
	// The author is the device, not the session.
	const client = connect({
		key,
		cache: source.cache,
		open: source.open(key),
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
