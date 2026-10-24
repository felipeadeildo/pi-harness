import { factsOf } from "@adeildo/pi-remote-client";
import { openAsks } from "@adeildo/pi-remote-protocol";
// The route of one session: it reads which one from the address and hands the screen what the client
// holds. Everything else lives under `src/session` and `src/screens/session`.
import { Link, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { Composer } from "../../../screens/session/composer.tsx";
import { QuestionDialog } from "../../../screens/session/questions.tsx";
import { SessionScreen } from "../../../screens/session/session.tsx";
import { browserSource } from "../../../session/browser.ts";
import { useSession } from "../../../session/use-session.ts";

export default function SessionRoute() {
	const { machine, id } = useLocalSearchParams<{ machine: string; id: string }>();
	const { session, client, why } = useSession({ machine, session: id }, browserSource);
	if (why !== undefined)
		return (
			<View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
				<Text>{why}</Text>
			</View>
		);
	// One question at a time, and it sits above the composer: it is the thing the agent is waiting on.
	// The oldest comes first: whoever asked first has been waiting longest, and a question nobody can
	// answer is worse than one answered in an order the person did not choose.
	const waiting = session === undefined ? [] : openAsks(factsOf(session));
	const asked = waiting[0];
	return session === undefined || client === undefined ? null : (
		<View style={{ flex: 1 }}>
			{/* The way back, because a phone opened this page from a list and has no browser chrome. */}
			<Link href="/" style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
				All sessions
			</Link>
			<SessionScreen session={session} />
			{/* What the session is on now, so the pickers start where the session stands. */}
			<Composer
				client={client}
				mode={session.snapshot?.mode}
				model={session.snapshot?.model}
				thinking={session.snapshot?.thinkingLevel}
			/>
			{asked === undefined ? null : <QuestionDialog ask={asked} client={client} />}
		</View>
	);
}
