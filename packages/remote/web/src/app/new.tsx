// Starting pi on one of the owner's machines: a recent folder in one tap, or any folder by its path.
// The session opens once pi's bridge reaches the daemon.
import { readFolders, type RecentFolder, startSession } from "@adeildo/pi-remote-protocol/client";
import { Folder01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sessionHref } from "@/session/files-data.ts";
import { ago, folderOf, shortPath } from "@/session/format.ts";
import { whyOf } from "@/session/why.ts";

import { Icon, useNow } from "./kit.tsx";
import { MachinePick, useChosenMachine } from "./machine-pick.tsx";
import { Loaded, Quiet, useRead } from "./read.tsx";
import { SectionHeader } from "./shell.tsx";

export function Component(): ReactNode {
	const { answering, machine, why } = useChosenMachine();
	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<SectionHeader title="New session" />
			<div className="flex w-full max-w-2xl flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
				<MachinePick
					machines={answering}
					chosen={machine}
					hrefOf={(name) => `/new?machine=${encodeURIComponent(name)}`}
				/>
				{machine === undefined ? (
					<Quiet>{why ?? "Reading the machines…"}</Quiet>
				) : (
					<StartOn key={machine} machine={machine} />
				)}
			</div>
		</main>
	);
}

function StartOn({ machine }: { machine: string }): ReactNode {
	const read = useCallback(() => readFolders(location.origin, machine), [machine]);
	const [places, again] = useRead(read, "the recent folders");
	return (
		<Loaded state={places} again={again} reading="Reading the recent folders…">
			{(value) =>
				value.allowed ? (
					<Starter machine={machine} folders={value.folders} />
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
				Starting sessions is off on <span translate="no">{machine}</span>.
			</p>
			<p className="text-pretty text-muted-foreground">
				At that machine, open <code className="font-mono text-[13px]">/harness</code> in pi and turn
				on <span className="text-foreground">Start sessions from the page</span> under Remote.
				Anyone logged in to the remote can then run pi there.
			</p>
		</div>
	);
}

function Starter({
	machine,
	folders,
}: {
	machine: string;
	folders: readonly RecentFolder[];
}): ReactNode {
	const navigate = useNavigate();
	const now = useNow(60_000);
	const [typed, setTyped] = useState("");
	const [starting, setStarting] = useState<string>();
	const [why, setWhy] = useState<string>();

	const start = (folder: string): void => {
		setStarting(folder);
		setWhy(undefined);
		startSession(location.origin, machine, folder).then(
			(started) => navigate(sessionHref(started)),
			(error: unknown) => {
				setStarting(undefined);
				setWhy(whyOf(error, "the new session"));
			},
		);
	};
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		const folder = typed.trim();
		if (folder === "") setWhy("Type a folder, or pick a recent one.");
		else start(folder);
	};

	return (
		<>
			<form onSubmit={submit} className="flex flex-col gap-2">
				<label htmlFor="folder" className="text-[13px] font-medium text-muted-foreground">
					Folder
				</label>
				<div className="flex gap-2">
					<Input
						id="folder"
						name="folder"
						value={typed}
						onChange={(event) => setTyped(event.target.value)}
						placeholder="~/Projects/app…"
						autoComplete="off"
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						enterKeyHint="go"
						translate="no"
						aria-invalid={why !== undefined && starting === undefined ? true : undefined}
						aria-describedby="start-status"
						className="h-10 font-mono"
					/>
					<Button type="submit" className="h-10 px-4" disabled={starting !== undefined}>
						Start pi
					</Button>
				</div>
			</form>
			<p id="start-status" aria-live="polite" className="-mt-3 min-h-5 text-[13px]">
				{starting === undefined ? (
					<span className="text-destructive">{why}</span>
				) : (
					<span className="text-muted-foreground">
						Starting pi in <span translate="no">{shortPath(starting)}</span>…
					</span>
				)}
			</p>
			{folders.length === 0 ? (
				<Quiet>Pi has not worked in any folder there yet. Type one above.</Quiet>
			) : (
				<section aria-labelledby="recent" className="flex flex-col gap-1">
					<h2 id="recent" className="text-[13px] font-medium text-muted-foreground">
						Recent
					</h2>
					<ul className="-mx-2.5 flex flex-col">
						{folders.map((folder) => (
							<li key={folder.path}>
								<RecentRow
									folder={folder}
									now={now}
									starting={starting === folder.path}
									busy={starting !== undefined}
									start={start}
								/>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	);
}

/** One tap starts pi there. */
function RecentRow({
	folder,
	now,
	starting,
	busy,
	start,
}: {
	folder: RecentFolder;
	now: number;
	starting: boolean;
	busy: boolean;
	start: (folder: string) => void;
}): ReactNode {
	return (
		<button
			type="button"
			disabled={busy}
			onClick={() => start(folder.path)}
			className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent"
		>
			<Icon
				icon={starting ? Loading03Icon : Folder01Icon}
				className={cn("size-4.5 text-pi", starting && "animate-spin motion-reduce:animate-none")}
			/>
			<span className="sr-only">Start pi in </span>
			<span
				className={cn("flex min-w-0 flex-1 flex-col gap-0.5", busy && !starting && "opacity-50")}
			>
				<span className="truncate text-[15px] font-medium" translate="no">
					{folderOf(folder.path)}
				</span>
				<span className="truncate font-mono text-[11.5px] text-dim" translate="no">
					{shortPath(folder.path)}
				</span>
			</span>
			<span className="tabular shrink-0 text-[12px] text-dim">
				{starting ? "Starting…" : ago(folder.at, now)}
			</span>
		</button>
	);
}
