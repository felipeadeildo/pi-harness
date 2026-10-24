// The first screen, which is a promise rather than a list: the app is not wired to a daemon yet.
import { StyleSheet, Text, View } from "react-native";

export default function Sessions() {
	return (
		<View style={styles.page}>
			<Text style={styles.title}>pi remote</Text>
			<Text style={styles.line}>No session is open yet.</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, alignItems: "flex-start", justifyContent: "center", padding: 24, gap: 8 },
	title: { fontSize: 24, fontWeight: "600" },
	line: { fontSize: 15, opacity: 0.7 },
});
