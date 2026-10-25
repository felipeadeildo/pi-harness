// The session screen: the frame and the chrome in React Native, and the document handed to the one
// component that draws text from elsewhere. A phone has no `main` or `ol`, and a browser has no reason
// to draw them around a document either: one frame, two hosts.
import type { ClientSession } from "@adeildo/pi-remote-client";
import { openQuestions } from "@adeildo/pi-remote-protocol";
import { type ReactNode } from "react";
import { View } from "react-native";

import { OpenQuestions, Tasks } from "./chrome.tsx";
import { SessionDocument, viewOf } from "./session-document.tsx";

export { aboutOf, LINE_CHARS, OUTPUT_LINES, titleOf, viewOf } from "./session-document.tsx";

export function SessionScreen({ session }: { session: ClientSession }): ReactNode {
	const { state } = viewOf(session);
	return (
		<View style={{ flex: 1, paddingHorizontal: 16 }}>
			<Tasks tasks={state.tasks} />
			<OpenQuestions asks={openQuestions(state)} />
			<SessionDocument session={session} />
		</View>
	);
}
