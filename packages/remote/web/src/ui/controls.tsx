// The controls a page is made of: each is at least `--hit` on its short side, says what it is to a
// screen reader, and shows its state in more than color.
import { type ReactNode } from "react";

interface ControlProps {
	label: string;
	onPress: () => void;
	disabled?: boolean;
}

/** The one action a screen is for: filled. A destructive one takes the danger color in the same place. */
export function Primary({
	label,
	onPress,
	disabled,
	danger,
}: ControlProps & { danger?: boolean }): ReactNode {
	return (
		<button
			type="button"
			className={danger === true ? "primary danger" : "primary"}
			aria-label={label}
			disabled={disabled}
			onClick={onPress}
		>
			{label}
		</button>
	);
}

/** A quiet action: a line around it, no fill. `mark` replaces the visible label, never the name. */
export function Action({
	label,
	onPress,
	disabled,
	mark,
}: ControlProps & { mark?: string }): ReactNode {
	return (
		<button
			type="button"
			className="action"
			aria-label={label}
			disabled={disabled}
			onClick={onPress}
		>
			{mark ?? label}
		</button>
	);
}

/** A picker that shows what is chosen and opens the list: "Permission mode: edits" to a screen reader. */
export function Trigger({
	title,
	value,
	onPress,
}: {
	title: string;
	value: string;
	onPress?: () => void;
}): ReactNode {
	return (
		<button
			type="button"
			className="trigger"
			aria-label={value === "" ? title : `${title}: ${value}`}
			disabled={onPress === undefined}
			onClick={onPress}
		>
			<span className="trigger-value">{value === "" ? title : value}</span>
			{onPress === undefined ? null : <span aria-hidden="true">⌄</span>}
		</button>
	);
}

/**
 * One row of a list where exactly one is on, marked the way the terminal marks its selected row: a bar
 * in the accent against the left edge, `❯` before the label, and the label in bold. The rows that are
 * not on keep the column of the pointer empty, so nothing shifts when the choice moves.
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
	return (
		<div
			role="radio"
			tabIndex={0}
			className={chosen ? "option chosen" : "option"}
			aria-label={label}
			aria-checked={chosen}
			title={hint}
			onClick={onPress}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onPress();
				}
			}}
		>
			{chosen ? <span className="bar" data-testid="option-bar" /> : null}
			<span className="pointer">{chosen ? "\u276F" : ""}</span>
			<span className="text">
				<span className="label">{label}</span>
				{hint === undefined ? null : <span className="hint">{`  ${hint}`}</span>}
			</span>
		</div>
	);
}
