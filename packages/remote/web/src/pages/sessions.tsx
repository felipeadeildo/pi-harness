// Every session on every machine of the owner, grouped by machine. Rows are worked out in `rows.ts`.
import { type ListedSession, listSessions } from "@adeildo/pi-remote-protocol/client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { browserSource } from "../session/browser.ts";
import { countOf, groupsOf, keyOf, type Mark, type Row, rowsOf } from "../session/rows.ts";
import { piColor, type Scheme } from "../ui/pi-colors.ts";
import { useScheme } from "../ui/use-scheme.ts";

export const REREAD_MS = 3_000;

export function Component() {
	const [sessions, setSessions] = useState<readonly ListedSession[]>();
	const [why, setWhy] = useState<string>();
	// A row's place never changes on refresh, only its mark.
	const kept = useRef<readonly string[] | undefined>(undefined);
	const scheme = useScheme();

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
					// A later failure keeps the rows; only the first read decides whether there is a list.
					if (!open || sessions !== undefined) return;
					setWhy(error instanceof Error ? error.message : "The sessions could not be read.");
				});
		};
		read();
		// There is no socket here, so the list polls; coming back to the tab asks at once.
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

	// Blank while the daemon answers: only the daemon can say no session is open.
	if (why !== undefined)
		return (
			<main className="page">
				<p>{why}</p>
			</main>
		);
	if (sessions === undefined) return <main className="page" />;
	const rows = rowsOf(sessions, kept.current);
	return (
		<main className="page">
			<header className="list-head">
				<h1>Sessions</h1>
				<p className="quiet">{rows.length === 0 ? "None open" : countOf(rows)}</p>
			</header>
			{rows.length === 0 ? (
				<p className="empty">
					Start pi in a terminal on any of your machines, and it shows up here.
				</p>
			) : (
				groupsOf(rows).map((group) => (
					<section key={group.machine} className="machine">
						<h2>{group.machine}</h2>
						<ul className="sessions">
							{group.rows.map((row) => (
								<li key={`${row.machine}/${row.session}`}>
									<SessionRow row={row} scheme={scheme} />
								</li>
							))}
						</ul>
					</section>
				))
			)}
		</main>
	);
}

/** The terminal's marks, as the footer and the room use them. */
const MARKS: Record<Mark, string> = { working: "●", idle: "○", waits: "⚑" };

function SessionRow({ row, scheme }: { row: Row; scheme: Scheme }): ReactNode {
	const color = piColor(scheme, row.color);
	return (
		<Link
			className={`row ${row.mark}`}
			to={`/session/${encodeURIComponent(row.machine)}/${encodeURIComponent(row.session)}`}
		>
			<span className="mark" aria-hidden="true">
				{MARKS[row.mark]}
			</span>
			<span className="row-line">
				<span className="name" style={color === undefined ? undefined : { color }}>
					{row.name}
				</span>
				<span className="folder">{row.folder}</span>
				<span className="cost">{row.cost}</span>
			</span>
			<span className="row-line about">
				<span className="doing">{row.doing}</span>
				<span>{row.model}</span>
			</span>
		</Link>
	);
}
