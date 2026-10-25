// The session screen: the chrome in React Native beside a document that draws text from elsewhere. The
// route owns the layout, so this adds no frame of its own. A second `flex` here pushed the composer off
// the screen, and the composer is where the thumb is.
import type { ClientSession } from "@adeildo/pi-remote-client";
import { openQuestions } from "@adeildo/pi-remote-protocol";
import { Fragment, type ReactNode } from "react";

import { OpenQuestions, Tasks, TerminalWait } from "./chrome.tsx";
import { SessionDocument, viewOf } from "./session-document.tsx";

export function SessionScreen({ session }: { session: ClientSession }): ReactNode {
	const { state } = viewOf(session);
	return (
		<Fragment>
			<Tasks tasks={state.tasks} />
			<OpenQuestions asks={openQuestions(state)} />
			<TerminalWait prompt={state.prompt} />
			{/* The document sizes itself, so the frame does not guess: a DOM component with no height
			    draws nothing on a phone, and `matchContents` is what measures it. */}
			<SessionDocument session={session} dom={{ matchContents: true }} />
		</Fragment>
	);
}
