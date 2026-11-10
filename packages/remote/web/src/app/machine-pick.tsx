// Which of the owner's machines a screen acts on: the one the address names, or this one.
import type { ListedMachine } from "@adeildo/pi-remote-protocol/client";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { useMachines } from "./machines.tsx";

export function useChosenMachine(): {
	answering: readonly ListedMachine[];
	machine: string | undefined;
	why: string | undefined;
} {
	const [search] = useSearchParams();
	const { machines, why } = useMachines();
	const answering = machines?.filter((one) => one.answering) ?? [];
	const machine = search.get("machine") ?? answering.find((one) => one.here)?.name;
	return { answering, machine, why };
}

/** Shown only with more than one machine; the machine lives in the address, so a link can name it. */
export function MachinePick({
	machines,
	chosen,
	hrefOf,
}: {
	machines: readonly ListedMachine[];
	chosen: string | undefined;
	hrefOf: (machine: string) => string;
}): ReactNode {
	if (machines.length < 2 || chosen === undefined) return null;
	return (
		<nav aria-label="Machine" className="flex flex-wrap gap-1.5">
			{machines.map((one) => (
				<Link
					key={one.name}
					to={hrefOf(one.name)}
					replace
					aria-current={one.name === chosen ? "page" : undefined}
					translate="no"
					className={cn(
						"rounded-full border px-3 py-1.5 text-[13.5px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
						one.name === chosen
							? "border-pi font-medium text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{one.name}
				</Link>
			))}
		</nav>
	);
}
