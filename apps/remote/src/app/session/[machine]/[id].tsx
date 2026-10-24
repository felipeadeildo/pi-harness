// The route of one session: it reads which one from the address and hands the screen what the client
// holds. Everything else lives under `src/session` and `src/screens/session`.
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { SessionScreen } from "../../../screens/session/session.tsx";
import { browserSource } from "../../../session/browser.ts";
import { useSession } from "../../../session/use-session.ts";

export default function SessionRoute() {
	const { machine, id } = useLocalSearchParams<{ machine: string; id: string }>();
	const { session, why } = useSession({ machine, session: id }, browserSource);
	if (why !== undefined)
		return (
			<View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
				<Text>{why}</Text>
			</View>
		);
	return session === undefined ? null : <SessionScreen session={session} />;
}
