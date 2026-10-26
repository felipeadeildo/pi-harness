// The way in: every session the daemon knows, each row opening one. The link `/remote` prints lands
// here, so this is the first thing the page shows after the login. What a row says is worked out in
// `rows.ts`, which is plain data and is what a test reads.
import { type ListedSession, listSessions } from "@adeildo/pi-remote-protocol/client";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { browserSource } from "../session/browser.ts";
import { keyOf, rowsOf } from "../session/rows.ts";

/** How often the list asks the daemon again while it is on screen. Loopback and a tunnel both take it. */
export const REREAD_MS = 3_000;

export function Component() {
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
					return listSessions(location.origin);
				})
				.then((listed) => {
					if (!open) return;
					kept.current ??= listed.map(keyOf);
					setSessions(listed);
					setWhy(undefined);
				})
				.catch((error: unknown) => {
					// A later failure does not erase a list the person is reading: it would replace rows that
					// are still true with an apology. Only the first read decides whether there is a list.
					if (!open || sessions !== undefined) return;
					setWhy(error instanceof Error ? error.message : "The sessions could not be read.");
				});
		};
		read();
		// The status of a session changes without the list changing, and there is no socket here: the list
		// asks again. Coming back to the tab asks at once, so a phone that slept does not show the past.
		const every = setInterval(read, REREAD_MS);
		const back = (): void => {
			if (document.visibilityState === "visible") read();
		};
		document.addEventListener("visibilitychange", back);
		return () => {
			open = false;
			clearInterval(every);
			document.removeEventListener("visibilitychange", back);
		};
	}, [sessions]);

	// A blank frame while the daemon answers, and never an empty screen that says there is nothing:
	// "no session is open" is a state change only the daemon can make.
	if (why !== undefined)
		return (
			<main className="page">
				<p>{why}</p>
			</main>
		);
	if (sessions === undefined) return <main className="page" />;
	const rows = rowsOf(sessions, kept.current);
	if (rows.length === 0)
		return (
			<main className="page">
				<p className="quiet">No session is open.</p>
			</main>
		);
	return (
		<main className="page">
			<ul className="sessions">
				{rows.map((row) => (
					<li key={`${row.machine}/${row.session}`}>
						<Link
							className={row.waits ? "row waits" : "row"}
							to={`/session/${encodeURIComponent(row.machine)}/${encodeURIComponent(row.session)}`}
						>
							<span className="name">{row.name}</span>
							<span className="line">
								<span className="quiet">{row.where}</span>
								<span className="quiet">{row.doing}</span>
								<span className="quiet">{row.cost}</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}
