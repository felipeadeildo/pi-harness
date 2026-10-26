import { harnessOf } from "@adeildo/pi-remote-client";
import { openQuestions } from "@adeildo/pi-remote-protocol";
// The route of one session: it reads which one from the address and hands the screen what the client
// holds. Everything else lives under `src/session` and `src/screens/session`.
import { Link, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { Composer } from "../../../screens/session/composer.tsx";
import { composerOf } from "../../../screens/session/live.ts";
import { QuestionDialog } from "../../../screens/session/questions.tsx";
import { SessionScreen } from "../../../screens/session/session.tsx";
import { browserSource } from "../../../session/browser.ts";
import { useSession } from "../../../session/use-session.ts";
import { useTheme } from "../../../ui/use-theme.ts";

export default function SessionRoute() {
	const { machine, id } = useLocalSearchParams<{ machine: string; id: string }>();
	const theme = useTheme();
	const { session, client, why } = useSession({ machine, session: id }, browserSource);
	if (why !== undefined)
		return (
			<View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
				<Text style={{ color: theme.color.text }}>{why}</Text>
			</View>
		);
	if (session === undefined || client === undefined) return null;
	// One question at a time, and it sits above the composer: it is the thing the agent is waiting on.
	// The oldest comes first: whoever asked first has been waiting longest, and a question nobody can
	// answer is worse than one answered in an order the person did not choose.
	const asked = openQuestions(harnessOf(session))[0];
	return (
		<View style={{ flex: 1 }}>
			{/* The way back, because a phone opened this page from a list and has no browser chrome. */}
			<Link
				href="/"
				style={{
					...theme.type.label,
					color: theme.color.accent,
					minHeight: theme.hit,
					paddingHorizontal: theme.space(6),
					paddingVertical: theme.space(4),
				}}
			>
				All sessions
			</Link>
			{/* The conversation scrolls and the composer does not: a long transcript must not push the
			    field off the screen, because the field is where the thumb is. */}
			<ScrollView style={{ flex: 1 }}>
				<SessionScreen session={session} />
			</ScrollView>
			{/* A question takes the composer's place: two fields on a phone is one too many, and the
			    composer stays mounted behind it, so the draft is there when the question closes. */}
			<View style={{ display: asked === undefined ? "flex" : "none" }}>
				<Composer client={client} view={composerOf(session)} />
			</View>
			{asked === undefined ? null : <QuestionDialog ask={asked} client={client} />}
		</View>
	);
}
