// The terminals of one of the owner's machines: every session of its remote tmux, the shells and
// the pi sessions started from the page, and a new shell in a folder.
import { listTerminals, newTerminal, type TerminalInfo } from "@adeildo/pi-remote-protocol/client";
import { ComputerTerminal01Icon } from "@hugeicons/core-free-icons";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ago, shortPath } from "@/session/format.ts";
import { terminalHref } from "@/session/terminal-data.ts";
import { whyOf } from "@/session/why.ts";

import { Icon, useNow } from "./kit.tsx";
import { MachinePick, useChosenMachine } from "./machine-pick.tsx";
import { Loaded, Quiet, useRead } from "./read.tsx";
import { SectionHeader } from "./shell.tsx";

export function Component(): ReactNode {
	const { answering, machine, why } = useChosenMachine();
	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<SectionHeader title="Terminals" />
			<div className="flex w-full max-w-2xl flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
				<MachinePick
					machines={answering}
					chosen={machine}
					hrefOf={(name) => `/terminals?machine=${encodeURIComponent(name)}`}
				/>
				{machine === undefined ? (
					<Quiet>{why ?? "Reading the machines…"}</Quiet>
				) : (
					<On key={machine} machine={machine} />
				)}
			</div>
		</main>
	);
}

function On({ machine }: { machine: string }): ReactNode {
	const read = useCallback(() => listTerminals(location.origin, machine), [machine]);
	const [list, again] = useRead(read, "the terminals");
	return (
		<Loaded state={list} again={again} reading="Reading the terminals…">
			{(value) =>
				value.allowed ? (
					<>
						<NewShell machine={machine} />
						<Terminals machine={machine} terminals={value.terminals} />
					</>
				) : (
					<Off machine={machine} />
				)
			}
		</Loaded>
	);
}

function Off({ machine }: { machine: string }): ReactNode {
	return (
		<div className="flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 text-[14px]">
			<p className="font-medium">
				Terminals are off on <span translate="no">{machine}</span>.
			</p>
			<p className="text-pretty text-muted-foreground">
				At that machine, open <code className="font-mono text-[13px]">/harness</code> in pi and turn
				on <span className="text-foreground">Terminals from the page</span> under Remote. Anyone
				logged in to the remote can then run any command there.
			</p>
		</div>
	);
}

/** The folder comes from the address too, so a session's "Terminal here" fills it in. */
function NewShell({ machine }: { machine: string }): ReactNode {
	const [search] = useSearchParams();
	const navigate = useNavigate();
	const [folder, setFolder] = useState(search.get("folder") ?? "~");
	const [opening, setOpening] = useState(false);
	const [why, setWhy] = useState<string>();
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		setOpening(true);
		setWhy(undefined);
		newTerminal(location.origin, machine, folder.trim() || "~").then(
			(made) => navigate(terminalHref(made.machine, made.name)),
			(error: unknown) => {
				setOpening(false);
				setWhy(whyOf(error, "the new terminal"));
			},
		);
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<label htmlFor="shell-folder" className="text-[13px] font-medium text-muted-foreground">
				New shell in
			</label>
			<div className="flex gap-2">
				<Input
					id="shell-folder"
					name="folder"
					value={folder}
					onChange={(event) => setFolder(event.target.value)}
					autoComplete="off"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					enterKeyHint="go"
					translate="no"
					aria-invalid={why === undefined ? undefined : true}
					aria-describedby="shell-status"
					className="h-10 font-mono"
				/>
				<Button type="submit" className="h-10 px-4" disabled={opening}>
					{opening ? "Opening…" : "Open shell"}
				</Button>
			</div>
			<p id="shell-status" aria-live="polite" className="min-h-5 text-[13px] text-destructive">
				{why}
			</p>
		</form>
	);
}

function Terminals({
	machine,
	terminals,
}: {
	machine: string;
	terminals: readonly TerminalInfo[];
}): ReactNode {
	const now = useNow(60_000);
	if (terminals.length === 0) return <Quiet>No terminal is open there yet.</Quiet>;
	return (
		<section aria-labelledby="open-terminals" className="flex flex-col gap-1">
			<h2 id="open-terminals" className="text-[13px] font-medium text-muted-foreground">
				Open
			</h2>
			<ul className="-mx-2.5 flex flex-col">
				{terminals.map((one) => (
					<li key={one.name}>
						<Link
							to={terminalHref(machine, one.name)}
							className="flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							<Icon icon={ComputerTerminal01Icon} className="size-4.5 text-pi" />
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="truncate font-mono text-[14px] font-medium" translate="no">
									{one.name}
									<span className="ml-2 font-sans text-[12.5px] font-normal text-muted-foreground">
										{one.command}
									</span>
								</span>
								<span className="truncate font-mono text-[11.5px] text-dim" translate="no">
									{shortPath(one.folder)}
								</span>
							</span>
							<span className="tabular shrink-0 text-[12px] text-dim">{ago(one.created, now)}</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
