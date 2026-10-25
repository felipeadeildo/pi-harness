// The way in: every session the daemon knows, each row opening one. The link that `/remote` prints
// lands here, so this is the first thing a phone shows after the login.
import { type ListedSession, listSessions } from "@adeildo/pi-remote-client";
import type { Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";

import { keyOf } from "../screens/sessions/rows.ts";
import { SessionsScreen } from "../screens/sessions/sessions.tsx";
import { browserSource } from "../session/browser.ts";

/** How often the list asks the daemon again while it is on screen. Loopback and a tunnel both take it. */
export const REREAD_MS = 3_000;

/** Where a row leads, in the app's own addresses. */
export function sessionHref(session: ListedSession): Href {
	return `/session/${encodeURIComponent(session.machine)}/${encodeURIComponent(session.session)}`;
}

export default function Sessions() {
	const [sessions, setSessions] = useState<readonly ListedSession[]>();
	const [why, setWhy] = useState<string>();
	// The order the list had when it opened: a session that starts waiting changes its mark, never its
	// place, so a refresh cannot move a row under the thumb that was reaching for it.
	const kept = useRef<readonly string[] | undefined>(undefined);

	useEffect(() => {
		let open = true;
		const read = (): void => {
			void browserSource()
				.then((ready) => {
					if (ready.why !== undefined) throw new Error(ready.why);
					// The page asks the daemon it came from: the socket's origin is where the sessions live.
					return listSessions(globalThis.location.origin);
				})
				.then((listed) => {
					if (!open) return;
					kept.current ??= listed.map(keyOf);
					setSessions(listed);
					setWhy(undefined);
				})
				.catch((error: unknown) => {
					// A later failure does not erase a list the person is reading: it would replace rows that
					// are still true with an apology. Only the first read decides whether there is a list at
					// all, and the rest keep what was drawn.
					if (!open || sessions !== undefined) return;
					setWhy(error instanceof Error ? error.message : "The sessions could not be read.");
				});
		};
		read();
		// The status of a session changes without the list changing, and there is no socket here: the list
		// asks again. Coming back to the tab asks at once, so a phone that slept does not show the past.
		const every = setInterval(read, REREAD_MS);
		const back = AppState.addEventListener("change", (state) => {
			if (state === "active") read();
		});
		return () => {
			open = false;
			clearInterval(every);
			back.remove();
		};
	}, [sessions]);

	// A blank frame while the daemon answers, and never an empty screen that says there is nothing:
	// "no session is open" is a state change only the daemon can make.
	if (why !== undefined)
		return (
			<View style={{ flex: 1, padding: 24 }}>
				<Text>{why}</Text>
			</View>
		);
	if (sessions === undefined) return <View style={{ flex: 1 }} />;
	return <SessionsScreen sessions={sessions} kept={kept.current} hrefOf={sessionHref} />;
}
