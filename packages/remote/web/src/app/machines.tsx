// The owner's machines as this daemon knows them: the ones answering, how many sessions each has
// open and which harness each runs, and the ones that stopped answering, with when they last did.
import {
	type ListedMachine,
	type ListedSession,
	listMachines,
} from "@adeildo/pi-remote-protocol/client";
import { ComputerIcon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { type ReactNode, useEffect, useState } from "react";

import { browserSource } from "@/session/browser.ts";
import { ago } from "@/session/format.ts";

import { Icon, useNow } from "./kit.tsx";
import { useSessions } from "./list.tsx";
import { SectionHeader } from "./shell.tsx";

/** The daemon looks for machines every fifteen seconds; reading faster shows nothing new. */
const REREAD_MS = 15_000;

function useMachines(): {
	machines: readonly ListedMachine[] | undefined;
	why: string | undefined;
} {
	const [machines, setMachines] = useState<readonly ListedMachine[]>();
	const [why, setWhy] = useState<string>();
	useEffect(() => {
		let open = true;
		const load = (): void => {
			void browserSource()
				.then((ready) => {
					if (ready.why !== undefined) throw new Error(ready.why);
					return listMachines(location.origin);
				})
				.then((listed) => {
					if (!open) return;
					setMachines(listed);
					setWhy(undefined);
				})
				.catch((error: unknown) => {
					if (open)
						setWhy(error instanceof Error ? error.message : "The machines could not be read.");
				});
		};
		load();
		const every = setInterval(load, REREAD_MS);
		return () => {
			open = false;
			clearInterval(every);
		};
	}, []);
	return { machines, why };
}

export function Component(): ReactNode {
	const { machines, why } = useMachines();
	const { sessions } = useSessions();
	const now = useNow(5000);
	const here = machines?.find((one) => one.here);
	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<SectionHeader title="Machines" />
			<div className="flex w-full max-w-2xl flex-col gap-1 px-3 pb-6">
				{why !== undefined && machines === undefined ? (
					<p className="p-4 text-sm text-destructive">{why}</p>
				) : null}
				{machines === undefined ? null : (
					<ul className="flex flex-col gap-0.5">
						{machines.map((machine) => (
							<li key={machine.name}>
								<MachineRow
									machine={machine}
									open={openOn(sessions, machine.name)}
									version={here?.version}
									now={now}
								/>
							</li>
						))}
					</ul>
				)}
				{machines?.length === 1 ? (
					<p className="max-w-md px-2.5 pt-4 text-[13px] text-muted-foreground">
						Only this machine answers. Another computer of yours on the tailnet shows up here once
						its pi runs the remote.
					</p>
				) : null}
			</div>
		</main>
	);
}

function openOn(
	sessions: readonly ListedSession[] | undefined,
	machine: string,
): number | undefined {
	return sessions?.filter((one) => one.machine === machine && one.gone === undefined).length;
}

function MachineRow({
	machine,
	open,
	version,
	now,
}: {
	machine: ListedMachine;
	open: number | undefined;
	/** This machine's harness, to point out one that runs another. */
	version: string | undefined;
	now: number;
}): ReactNode {
	const other = version !== undefined && machine.version !== version;
	return (
		<div
			className={cn("flex gap-2.5 rounded-xl px-2.5 py-2.5", !machine.answering && "opacity-60")}
		>
			<Icon
				icon={ComputerIcon}
				className={cn("mt-0.5 size-4", machine.answering ? "text-pi" : "text-dim")}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="wide truncate text-[15px] font-semibold">{machine.name}</span>
					{machine.here ? (
						<span className="shrink-0 text-[13px] text-muted-foreground">this machine</span>
					) : null}
				</div>
				<p className="text-[13px] text-muted-foreground">
					{machine.answering ? sessionsText(open) : `Stopped answering ${since(machine.seen, now)}`}
				</p>
				<div className="flex min-w-0 flex-wrap items-center gap-x-3 font-mono text-[11.5px] text-dim">
					<span className={cn("tabular", other && "text-waits")}>
						harness {machine.version}
						{other ? `, this one runs ${version}` : ""}
					</span>
					{machine.answering ? (
						<span className="tabular">remote up {ago(machine.startedAt, now)}</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

function since(at: number, now: number): string {
	const span = ago(at, now);
	return span === "now" ? "just now" : `${span} ago`;
}

function sessionsText(open: number | undefined): string {
	if (open === undefined) return "Reading its sessions";
	if (open === 0) return "No session open";
	return open === 1 ? "1 session open" : `${open} sessions open`;
}
