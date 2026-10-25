// The list of sessions, drawn in React Native: the same file opens in a browser, on a phone and on a
// desktop, and `main`/`p`/`a href` exist in only one of them. What a row says is worked out in
// `rows.ts`, which is plain data and is what a test reads.
//
// A row navigates with the router and carries one flattened style object. Both halves are deliberate:
// `Link asChild` hands its props to the child through a Slot that spreads `style` as a plain object, so
// an array there becomes `{0: …, 1: …}` and the browser throws setting `style[0]` before drawing. The
// browser check in `scripts/csp.ts` is what catches this family, since static markup applies no style.
import type { ListedSession } from "@adeildo/pi-remote-client";
import { type Href, Link } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { rowStyle, rowsOf } from "./rows.ts";

export { nameOf, rowStyle, type Row, rowsOf } from "./rows.ts";

export interface SessionsScreenProps {
	sessions: readonly ListedSession[];
	/** Where a row goes; the row is the link, so the whole line is tappable. */
	hrefOf: (session: ListedSession) => Href;
	/** The order the list had when it opened; omitted, the list orders itself. */
	kept?: readonly string[];
}

export function SessionsScreen({ sessions, kept, hrefOf }: SessionsScreenProps) {
	const rows = rowsOf(sessions, kept);
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
				// A row is a real link: middle click, a new tab and a screen reader all depend on it. The
				// style is one flat object because `Link asChild` spreads the child's props through a Slot,
				// and an array spread there becomes `{0: …}` — which the browser refuses to apply.
				<Link href={hrefOf(item.listed)} asChild>
					<Pressable style={rowStyle(item.waits)}>
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

	name: { fontSize: 17, fontWeight: "600" },
	line: { flexDirection: "row", gap: 12 },
	where: { fontSize: 13, opacity: 0.7 },
	doing: { fontSize: 13 },
	cost: { fontSize: 13, opacity: 0.7 },
});
