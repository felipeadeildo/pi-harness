// The way in: every session the daemon knows, each row opening one. The link that `/remote` prints
// lands here, so this is the first thing a phone shows after the login.
import { type ListedSession, listSessions } from "@adeildo/pi-remote-client";
import { createElement as h, useEffect, useState } from "react";

import { SessionsScreen } from "../screens/sessions/sessions.tsx";
import { browserSource } from "../session/browser.ts";

/** Where a row leads, in the app's own addresses. */
export function sessionHref(session: ListedSession): string {
	return `/session/${encodeURIComponent(session.machine)}/${encodeURIComponent(session.session)}`;
}

export default function Sessions() {
	const [sessions, setSessions] = useState<readonly ListedSession[]>();
	const [why, setWhy] = useState<string>();

	useEffect(() => {
		let open = true;
		void browserSource()
			.then((ready) => {
				if (ready.why !== undefined) throw new Error(ready.why);
				// The page asks the daemon it came from: the socket's origin is where the sessions live.
				return listSessions(globalThis.location.origin);
			})
			.then((listed) => {
				if (open) setSessions(listed);
			})
			.catch((error: unknown) => {
				if (open)
					setWhy(error instanceof Error ? error.message : "The sessions could not be read.");
			});
		return () => {
			open = false;
		};
	}, []);

	// A blank frame while the daemon answers, and never an empty screen that says there is nothing:
	// "no session is open" is a fact only the daemon can give.
	if (why !== undefined) return h("main", { className: "remote-sessions" }, h("p", undefined, why));
	if (sessions === undefined) return h("main", { className: "remote-sessions" });
	return h(SessionsScreen, { sessions, hrefOf: sessionHref });
}
