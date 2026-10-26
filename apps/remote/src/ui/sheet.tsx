// A sheet that rises from the bottom edge with a title and a list, where a choice is too long for a
// row. It closes on the shade, on its Close control and on the system back, and it never moves what is
// behind it: it is a layer, not a part of the layout.
import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { Action } from "./controls.tsx";
import { useTheme } from "./use-theme.ts";

export function Sheet({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}): ReactNode {
	const theme = useTheme();
	return (
		<Modal transparent animationType="slide" onRequestClose={onClose}>
			<Pressable
				aria-label="Close"
				onPress={onClose}
				style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }}
			/>
			<View
				role="dialog"
				aria-label={title}
				style={{
					maxHeight: "70%",
					gap: theme.space(3),
					padding: theme.space(4),
					borderTopLeftRadius: theme.radius(3),
					borderTopRightRadius: theme.radius(3),
					backgroundColor: theme.color.elevated,
				}}
			>
				<Text style={{ ...theme.type.heading, color: theme.color.text }}>{title}</Text>
				<ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
				<Action label="Close" onPress={onClose} />
			</View>
		</Modal>
	);
}
