// The list of sessions, drawn in React Native: the same file opens in a browser, on a phone and on a
// desktop, and `main`/`p`/`a href` exist in only one of them. What a row says is worked out in
// `rows.ts`, which is plain data and is what a test reads.
import type { ListedSession } from "@adeildo/pi-remote-client";
import { Link } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { rowsOf } from "./rows.ts";

export { nameOf, type Row, rowsOf } from "./rows.ts";

export interface SessionsScreenProps {
	sessions: readonly ListedSession[];
	/** Where a row goes; the row is the link, so the whole line is tappable. */
	hrefOf: (session: ListedSession) => string;
}

export function SessionsScreen({ sessions, hrefOf }: SessionsScreenProps) {
	const rows = rowsOf(sessions);
	if (rows.length === 0) {
		return (
			<View style={styles.page}>
				<Text style={styles.empty}>No session is open.</Text>
			</View>
		);
	}
	return (
		// A list, not a stack of views: a machine with forty sessions scrolls the same way it does on a
		// phone, and the row that waits is marked in place rather than moved.
		<FlatList
			style={styles.page}
			data={rows}
			keyExtractor={(row) => `${row.machine}/${row.session}`}
			renderItem={({ item }) => (
				<Link href={hrefOf(item.listed)} asChild>
					<Pressable style={[styles.row, item.waits ? styles.waits : undefined]}>
						<Text style={styles.name}>{item.name}</Text>
						<View style={styles.line}>
							<Text style={styles.where}>{item.where}</Text>
							<Text style={styles.doing}>{item.doing}</Text>
							<Text style={styles.cost}>{item.cost}</Text>
						</View>
					</Pressable>
				</Link>
			)}
		/>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, padding: 16, gap: 8 },
	empty: { fontSize: 15, opacity: 0.7 },
	row: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8, gap: 4 },
	// A session that waits on the person is marked by a rule on its side, not by a move: the order is
	// decided when the list is drawn, so nothing jumps under the thumb that was reaching for it.
	waits: { borderLeftWidth: 3, borderLeftColor: "#d97706" },
	name: { fontSize: 17, fontWeight: "600" },
	line: { flexDirection: "row", gap: 12 },
	where: { fontSize: 13, opacity: 0.7 },
	doing: { fontSize: 13 },
	cost: { fontSize: 13, opacity: 0.7 },
});
