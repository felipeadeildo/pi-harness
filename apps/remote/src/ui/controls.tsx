// The controls a screen is made of, drawn from the theme: a screen imports these and never a number.
// Every control is at least `theme.hit` points on its short side, says what it is to a screen reader,
// and shows its state in more than color.
import { type ReactNode } from "react";
import { Pressable, Text } from "react-native";

import { theme } from "./theme.ts";

interface ControlProps {
	label: string;
	onPress: () => void;
	disabled?: boolean;
}

/** The one action a screen is for: filled, and the only filled thing on it. */
export function Primary({ label, onPress, disabled }: ControlProps): ReactNode {
	return (
		<Pressable
			role="button"
			aria-label={label}
			aria-disabled={disabled === true}
			disabled={disabled}
			onPress={onPress}
			style={{
				minHeight: theme.hit,
				minWidth: theme.hit,
				paddingHorizontal: theme.space(5),
				borderRadius: theme.radius(1),
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: disabled === true ? theme.color.border : theme.color.accent,
			}}
		>
			<Text
				style={{
					...theme.type.label,
					color: disabled === true ? theme.color.faint : theme.color.background,
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

/** A quiet action: text in the muted color, a line around it, no fill. */
export function Action({ label, onPress, disabled }: ControlProps): ReactNode {
	return (
		<Pressable
			role="button"
			aria-label={label}
			aria-disabled={disabled === true}
			disabled={disabled}
			onPress={onPress}
			style={{
				minHeight: theme.hit,
				paddingHorizontal: theme.space(4),
				borderRadius: theme.radius(1),
				borderWidth: theme.line.hairline,
				borderColor: theme.color.border,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Text
				style={{
					...theme.type.label,
					color: disabled === true ? theme.color.faint : theme.color.text,
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * One of a few values, exactly one of which is on. The chosen one is told by a heavier line and a
 * heavier weight as well as by color, and a screen reader hears it as a radio that is checked.
 */
export function Chip({
	label,
	chosen,
	onPress,
	hint,
}: {
	label: string;
	chosen: boolean;
	onPress: () => void;
	/** What the value means, read after the label by a screen reader. */
	hint?: string;
}): ReactNode {
	return (
		<Pressable
			role="radio"
			aria-label={label}
			aria-checked={chosen}
			accessibilityHint={hint}
			onPress={onPress}
			style={{
				minHeight: theme.hit,
				paddingHorizontal: theme.space(4),
				borderRadius: theme.radius(2),
				borderWidth: chosen ? theme.line.thick : theme.line.hairline,
				borderColor: chosen ? theme.color.text : theme.color.border,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Text
				style={{
					...theme.type.label,
					fontWeight: chosen ? "600" : "500",
					color: chosen ? theme.color.text : theme.color.muted,
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}
