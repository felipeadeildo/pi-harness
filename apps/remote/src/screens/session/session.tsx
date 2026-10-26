// The session screen: the chrome in React Native beside a document that draws text from elsewhere. The
// route owns the layout, so this adds no frame of its own. A second `flex` here pushed the composer off
// the screen, and the composer is where the thumb is.
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";
import { Fragment, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { Board, TerminalWait } from "./chrome.tsx";
import SessionDocument from "./session-document.tsx";
import { viewOf } from "./session-view.ts";

export function SessionScreen({ session }: { session: ClientSession }): ReactNode {
	const { state } = viewOf(session);
	const scheme = useColorScheme() === "dark" ? "dark" : "light";
	return (
		<Fragment>
			<Board board={state.board} />
			<TerminalWait prompt={state.prompt} />
			{/* The document sizes itself, so the frame does not guess: a DOM component with no height
			    draws nothing on a phone, and `matchContents` is what measures it. */}
			<SessionDocument session={session} scheme={scheme} dom={{ matchContents: true }} />
		</Fragment>
	);
}
