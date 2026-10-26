// The controls a screen is made of, drawn from the theme: a screen imports these and never a number.
// Every control is at least `theme.hit` points on its short side, says what it is to a screen reader,
// and shows its state in more than color.
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import type { IconName } from "./icon-names.ts";
import { Icon } from "./icon.tsx";
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
	const live = danger === true ? theme.color.danger : theme.color.accent;
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
				backgroundColor: disabled === true ? theme.color.border : live,
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

/**
 * A quiet action: a line around it, no fill. It shows its label, or an icon when it has one: the label
 * is still what a screen reader says, so an icon-only control never loses its name.
 */
export function Action({
	label,
	onPress,
	disabled,
	icon,
}: ControlProps & { icon?: IconName }): ReactNode {
	const theme = useTheme();
	const color = disabled === true ? theme.color.faint : theme.color.text;
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
			{icon === undefined ? (
				<Text style={{ ...theme.type.label, color }}>{label}</Text>
			) : (
				<Icon name={icon} size={theme.type.heading.fontSize} color={color} />
			)}
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
			<View style={{ flexDirection: "row", alignItems: "center", gap: theme.space(2) }}>
				<Text
					numberOfLines={1}
					style={{ ...theme.type.label, color: theme.color.text, flexShrink: 1 }}
				>
					{value === "" ? title : value}
				</Text>
				{onPress === undefined ? null : (
					<Icon name="chevron" size={theme.type.caption.fontSize} color={theme.color.muted} />
				)}
			</View>
		</Pressable>
	);
}

/** One row of a list where exactly one is on: a heavier weight and a mark say which, not color alone. */
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
				justifyContent: "space-between",
				gap: theme.space(3),
			}}
		>
			<Text style={{ flex: 1 }}>
				<Text
					style={{
						...theme.type.body,
						fontWeight: chosen ? "600" : "400",
						color: theme.color.text,
					}}
				>
					{label}
				</Text>
				{hint === undefined ? null : (
					<Text style={{ ...theme.type.caption, color: theme.color.muted }}>{`  ${hint}`}</Text>
				)}
			</Text>
			<Text style={{ ...theme.type.body, color: theme.color.text }}>{chosen ? "\u2713" : ""}</Text>
		</Pressable>
	);
}
