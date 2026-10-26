// Every control is at least `--hit` on its short side, names itself to a screen reader, and shows
// its state in more than color.
import { type ReactNode } from "react";

interface ControlProps {
	label: string;
	onPress: () => void;
	disabled?: boolean;
}

/** A destructive one takes the danger color in the same place. */
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

/** `mark` replaces the visible label, never the accessible name. */
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

/** Reads "Permission mode: edits" to a screen reader. */
export function Trigger({
	title,
	word,
	value,
	onPress,
}: {
	title: string;
	/** `mode` before `manual`. */
	word: string;
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
			<span className="trigger-word" aria-hidden="true">
				{word}
			</span>
			<span className="trigger-pick">
				<span className="trigger-value">{value === "" ? "…" : value}</span>
				{onPress === undefined ? null : <span aria-hidden="true">⌄</span>}
			</span>
		</button>
	);
}

/** Marked like the terminal's selected row. Unselected rows keep the pointer column empty. */
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
