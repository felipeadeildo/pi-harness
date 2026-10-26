// The route of one session: it reads which one from the address and draws what the client holds. The
// conversation scrolls and the composer does not: a long transcript must not push the field off the
// screen, because the field is where the thumb is.
import { openQuestions } from "@adeildo/pi-remote-protocol";
import { harnessOf } from "@adeildo/pi-remote-protocol/client";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, useParams } from "react-router";

import { browserSource } from "../session/browser.ts";
import { Board, TerminalWait } from "../session/chrome.tsx";
import { Composer } from "../session/composer.tsx";
import { composerOf } from "../session/live.ts";
import { QuestionDialog } from "../session/questions.tsx";
import { viewOf } from "../session/session-view.ts";
import { Transcript } from "../session/transcript.tsx";
import { useSession } from "../session/use-session.ts";
import { useScheme } from "../ui/use-scheme.ts";

/** How close to the end the reader is still counted as being at it, in pixels. */
const AT_END = 80;

export function Component(): ReactNode {
	const { machine = "", id = "" } = useParams();
	const scheme = useScheme();
	const { session, client, why, changes } = useSession({ machine, session: id }, browserSource);
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);

	// A reader who scrolled up to read is left where they are; one at the end keeps seeing the end.
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
	// One question at a time, and it sits above the composer: it is the thing the agent is waiting on.
	// The oldest comes first: whoever asked first has been waiting longest.
	const asked = openQuestions(harnessOf(session))[0];
	const { state } = viewOf(session);
	return (
		<div className="session">
			{/* The way back, because a phone opened this page from a list and has no browser chrome. */}
			<Link className="back" to="/">
				All sessions
			</Link>
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
