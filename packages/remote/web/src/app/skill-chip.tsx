// A skill's name as a chip, in a prompt and where the skill was loaded.
import { BookOpen02Icon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import type { CSSProperties, ReactNode } from "react";

import { Icon } from "./kit.tsx";

export function SkillChip({
	name,
	onPress,
	className,
	style,
}: {
	name: string;
	onPress?: () => void;
	className?: string;
	style?: CSSProperties;
}): ReactNode {
	const look = cn(
		"inline-flex max-w-full items-center gap-1 rounded-md bg-pi/12 px-1.5 py-px align-baseline text-[0.9em] font-medium text-pi",
		onPress !== undefined &&
			"cursor-pointer transition-colors hover:bg-pi/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
		className,
	);
	const inside = (
		<>
			<Icon icon={BookOpen02Icon} className="size-[1em]" strokeWidth={2} />
			<span className="truncate">{name}</span>
		</>
	);
	if (onPress === undefined)
		return (
			<span className={look} style={style}>
				{inside}
			</span>
		);
	return (
		<button type="button" className={look} style={style} onClick={onPress}>
			{inside}
		</button>
	);
}
