// A long message shown to its first lines, with a button for the rest.
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useId, useState } from "react";

import { Icon } from "./kit.tsx";

const LONG_CHARS = 700;
const LONG_LINES = 14;

export function isLong(text: string): boolean {
	return text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;
}

export function Clamp({ long, children }: { long: boolean; children: ReactNode }): ReactNode {
	const [open, setOpen] = useState(false);
	const id = useId();
	if (!long) return children;
	return (
		<div className="flex min-w-0 flex-col">
			<div
				id={id}
				className={
					open
						? "min-w-0"
						: "max-h-56 min-w-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
				}
			>
				{children}
			</div>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
				className="mt-1 flex w-fit items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<Icon icon={open ? ArrowUp01Icon : ArrowDown01Icon} className="size-3.5" />
				{open ? "Show less" : "Show all"}
			</button>
		</div>
	);
}
