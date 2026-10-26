// The controls a screen is made of, drawn from the theme: a screen imports these and never a number.
// Every control is at least `theme.hit` points on its short side, says what it is to a screen reader,
// and shows its state in more than color.
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "./use-theme.ts";

interface ControlProps {
	label: string;
	onPress: () => void;
	disabled?: boolean;
}

/**
 * The one action a screen is for: filled, and the only filled thing on it. A destructive one takes the
 * danger color in the same place and size, so the person reads what it does before touching it.
 */
export function Primary({
	label,
	onPress,
	disabled,
	danger,
}: ControlProps & { danger?: boolean }): ReactNode {
	const theme = useTheme();
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
				backgroundColor:
					disabled === true
						? theme.color.border
						: danger === true
							? theme.color.danger
							: theme.color.accent,
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
	const theme = useTheme();
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
 * A picker that shows what is chosen and opens the list: the value is the label, so the row reads as
 * "Permission mode: edits" to a screen reader and as the value to the eye, and it keeps its width when
 * the value changes.
 */
export function Trigger({
	title,
	value,
	onPress,
}: {
	title: string;
	value: string;
	onPress?: () => void;
}): ReactNode {
	const theme = useTheme();
	return (
		<Pressable
			role="button"
			aria-label={value === "" ? title : `${title}: ${value}`}
			aria-disabled={onPress === undefined}
			disabled={onPress === undefined}
			onPress={onPress}
			style={{
				flexShrink: 1,
				minHeight: theme.hit,
				paddingHorizontal: theme.space(4),
				borderRadius: theme.radius(2),
				borderWidth: theme.line.hairline,
				borderColor: theme.color.border,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Text numberOfLines={1} style={{ ...theme.type.label, color: theme.color.text }}>
				{value === "" ? title : value}
				{onPress === undefined ? "" : " \u25BE"}
			</Text>
		</Pressable>
	);
}

/**
 * One row of a list where exactly one is on, marked the way the terminal marks its selected row, three
 * marks together: a bar in the accent against the left edge, `❯` in the accent before the label, and the
 * label in bold. The rows that are not on keep the column of the pointer empty, so nothing shifts when
 * the choice moves.
 */
export function Option({
	label,
	hint,
	chosen,
	onPress,
}: {
	label: string;
	hint?: string;
	chosen: boolean;
	onPress: () => void;
}): ReactNode {
	const theme = useTheme();
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
				flexDirection: "row",
				alignItems: "center",
				gap: theme.space(3),
			}}
		>
			<View
				testID={chosen ? "option-bar" : undefined}
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					bottom: 0,
					width: theme.line.thick,
					backgroundColor: chosen ? theme.color.accent : "transparent",
				}}
			/>
			<Text style={{ ...theme.type.body, color: theme.color.accent, width: theme.space(5) }}>
				{chosen ? "\u276F" : ""}
			</Text>
			<Text style={{ flex: 1 }}>
				<Text
					style={{
						...theme.type.body,
						fontWeight: chosen ? "700" : "400",
						color: theme.color.text,
					}}
				>
					{label}
				</Text>
				{hint === undefined ? null : (
					<Text style={{ ...theme.type.caption, color: theme.color.muted }}>{`  ${hint}`}</Text>
				)}
			</Text>
		</Pressable>
	);
}
