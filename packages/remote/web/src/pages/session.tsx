// One session. The conversation scrolls and the composer does not, so the field stays under the thumb.
import { openQuestions } from "@adeildo/pi-remote-protocol";
import { harnessOf } from "@adeildo/pi-remote-protocol/client";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, useParams } from "react-router";

import { browserSource } from "../session/browser.ts";
import { Board, TerminalWait } from "../session/chrome.tsx";
import { Composer } from "../session/composer.tsx";
import { composerOf } from "../session/live.ts";
import { plain } from "../session/plain.ts";
import { QuestionDialog } from "../session/questions.tsx";
import { aboutOf, titleOf, viewOf } from "../session/session-view.ts";
import { Transcript } from "../session/transcript.tsx";
import { useSession } from "../session/use-session.ts";
import { piColor } from "../ui/pi-colors.ts";
import { useScheme } from "../ui/use-scheme.ts";

const AT_END = 80;

export function Component(): ReactNode {
	const { machine = "", id = "" } = useParams();
	const scheme = useScheme();
	const { session, client, why, changes } = useSession({ machine, session: id }, browserSource);
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);

	// A reader who scrolled up stays put; one at the end keeps seeing the end.
	useEffect(() => {
		const box = scroller.current;
		if (box !== null && following.current) box.scrollTop = box.scrollHeight;
	}, [changes]);

	if (why !== undefined)
		return (
			<main className="page">
				<p>{why}</p>
			</main>
		);
	if (session === undefined || client === undefined) return <main className="page" />;
	// One question at a time, above the composer, oldest first.
	const asked = openQuestions(harnessOf(session))[0];
	const { state } = viewOf(session);
	const agent = piColor(scheme, state.theme?.color);
	return (
		<div className="session">
			<header className="session-bar">
				{/* The way back, because a phone opened this page from a list and has no browser chrome. */}
				<Link className="back" to="/" aria-label="All sessions">
					‹
				</Link>
				<div className="bar-title">
					<h1 style={agent === undefined ? undefined : { color: agent }}>
						{plain(titleOf(session))}
					</h1>
					<p className="quiet">{plain(aboutOf(session).join(" · "))}</p>
				</div>
			</header>
			<div
				ref={scroller}
				className="scroll"
				onScroll={(event) => {
					const box = event.currentTarget;
					following.current = box.scrollHeight - box.scrollTop - box.clientHeight < AT_END;
				}}
			>
				<Board board={state.board} />
				<TerminalWait prompt={state.prompt} />
				<Transcript session={session} scheme={scheme} />
			</div>
			{/* A question takes the composer's place: two fields on a phone is one too many, and the
			    composer stays mounted behind it, so the draft is there when the question closes. */}
			<div hidden={asked !== undefined}>
				<Composer
					client={client}
					view={composerOf(session)}
					ask={(question) => window.prompt(question) ?? undefined}
				/>
			</div>
			{asked === undefined ? null : <QuestionDialog ask={asked} client={client} />}
		</div>
	);
}
