// Every session on every machine of the owner, those that need you first. The list polls: it has no
// socket of its own.
import { type ListedSession, listSessions } from "@adeildo/pi-remote-protocol/client";
import {
	ArrowDown01Icon,
	Cancel01Icon,
	ComputerIcon,
	Flag02Icon,
	Folder01Icon,
	GitBranchIcon,
	HelpCircleIcon,
	Loading03Icon,
	MinusSignCircleIcon,
	PauseIcon,
	Search01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { browserSource } from "@/session/browser.ts";
import { ago } from "@/session/format.ts";
import { rememberListed } from "@/session/listed.ts";
import {
	countOf,
	type Group,
	type GroupBy,
	groupsOf,
	keyOf,
	matchRows,
	type Row,
	rowsOf,
} from "@/session/rows.ts";
import { piColor } from "@/ui/pi-colors.ts";
import { useScheme } from "@/ui/use-scheme.ts";

import { DoingLine, doingOf } from "./activity.tsx";
import { AgentName, Icon, StatusMark, useNow } from "./kit.tsx";

const REREAD_MS = 3_000;

/** The daemon's list, read again every few seconds and when the tab comes back. */
export function useSessions(): {
	sessions: readonly ListedSession[] | undefined;
	why: string | undefined;
	kept: readonly string[] | undefined;
} {
	const [sessions, setSessions] = useState<readonly ListedSession[]>();
	const [why, setWhy] = useState<string>();
	// A row's place never changes on refresh, only its mark.
	const kept = useRef<readonly string[] | undefined>(undefined);
	const read = useRef(false);
	useEffect(() => {
		let open = true;
		const load = (): void => {
			void browserSource()
				.then((ready) => {
					if (ready.why !== undefined) throw new Error(ready.why);
					return listSessions(location.origin);
				})
				.then((listed) => {
					if (!open) return;
					kept.current ??= listed.map(keyOf);
					rememberListed(listed);
					read.current = true;
					setSessions(listed);
					setWhy(undefined);
				})
				.catch((error: unknown) => {
					// A later failure keeps the rows; only the first read decides whether there is a list.
					if (!open || read.current) return;
					setWhy(error instanceof Error ? error.message : "The sessions could not be read.");
				});
		};
		load();
		const every = setInterval(load, REREAD_MS);
		const back = (): void => {
			if (document.visibilityState === "visible") load();
		};
		document.addEventListener("visibilitychange", back);
		return () => {
			open = false;
			clearInterval(every);
			document.removeEventListener("visibilitychange", back);
		};
	}, []);
	return { sessions, why, kept: kept.current };
}

export function SessionList({ current }: { current?: string }): ReactNode {
	const { sessions, why, kept } = useSessions();
	const [query, setQuery] = useState("");
	const [by, groupBy] = useGroupBy();
	const now = useNow(5000);
	if (why !== undefined) return <p className="p-4 text-sm text-destructive">{why}</p>;
	if (sessions === undefined) return <ListSkeleton />;
	const rows = rowsOf(sessions, kept);
	const shown = matchRows(rows, query);
	const groups = groupsOf(shown, by);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 px-1">
				<p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
					{rows.length === 0 ? "None open" : countOf(rows)}
				</p>
				{rows.length > 1 ? <GroupSwitch by={by} onChange={groupBy} /> : null}
			</div>
			{rows.length > 3 ? (
				<label className="flex h-10 items-center gap-2 rounded-xl border bg-raised px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
					<Icon icon={Search01Icon} className="text-dim" />
					<input
						type="search"
						aria-label="Search sessions"
						placeholder="Search by name, folder or branch"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="min-w-0 flex-1 bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
					/>
					{query === "" ? null : (
						<button type="button" aria-label="Clear the search" onClick={() => setQuery("")}>
							<Icon icon={Cancel01Icon} className="size-3.5 text-dim" />
						</button>
					)}
				</label>
			) : null}
			{rows.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
					<Icon icon={ComputerIcon} className="size-6 text-dim" />
					<p className="text-sm font-medium">No session is open</p>
					<p className="max-w-xs text-[13px] text-muted-foreground">
						Start pi in a terminal on any of your machines, and it shows up here.
					</p>
				</div>
			) : null}
			{rows.length > 0 && shown.length === 0 ? (
				<p className="px-1 py-6 text-center text-sm text-muted-foreground">
					No session matches the search.
				</p>
			) : null}
			{groups.map((group) => (
				<GroupView
					key={group.id}
					group={group}
					by={by}
					current={current}
					now={now}
					machines={new Set(rows.map((row) => row.machine)).size}
				/>
			))}
		</div>
	);
}

const GROUP_KEY = "pi-remote:group-by";

function useGroupBy(): [GroupBy, (by: GroupBy) => void] {
	const [by, setBy] = useState<GroupBy>(() =>
		localStorage.getItem(GROUP_KEY) === "folder" ? "folder" : "status",
	);
	return [
		by,
		(next) => {
			localStorage.setItem(GROUP_KEY, next);
			setBy(next);
		},
	];
}

function GroupSwitch({
	by,
	onChange,
}: {
	by: GroupBy;
	onChange: (by: GroupBy) => void;
}): ReactNode {
	return (
		<div
			role="radiogroup"
			aria-label="Group by"
			className="flex shrink-0 rounded-lg bg-muted p-0.5"
		>
			{(["status", "folder"] as const).map((one) => (
				<button
					type="button"
					role="radio"
					aria-checked={by === one}
					key={one}
					onClick={() => onChange(one)}
					className={cn(
						"rounded-md px-2.5 py-1 text-xs transition-colors",
						by === one
							? "bg-background font-medium text-foreground shadow-sm"
							: "text-muted-foreground",
					)}
				>
					{one === "status" ? "Status" : "Folder"}
				</button>
			))}
		</div>
	);
}

const GROUP_ICON: Record<string, IconSvgElement> = {
	you: Flag02Icon,
	working: Loading03Icon,
	idle: PauseIcon,
	closed: MinusSignCircleIcon,
};

function GroupView({
	group,
	by,
	current,
	now,
	machines,
}: {
	group: Group;
	by: GroupBy;
	current: string | undefined;
	now: number;
	machines: number;
}): ReactNode {
	const rows = (
		<ul className="flex flex-col gap-0.5">
			{group.rows.map((row) => (
				<li key={`${row.machine}/${row.session}`}>
					<SessionRow
						row={row}
						current={current === `${row.machine}/${row.session}`}
						now={now}
						showMachine={machines > 1}
						showFolder={by === "status" || group.closed === true}
					/>
				</li>
			))}
		</ul>
	);
	const icon = group.path === undefined ? GROUP_ICON[group.id] : Folder01Icon;
	const title = (
		<span
			className="flex items-center gap-2 px-1 text-[13px] font-semibold text-foreground"
			title={group.path}
		>
			{icon === undefined ? null : <Icon icon={icon} className="size-3.5 text-dim" />}
			{group.title}
			<span className="tabular font-normal text-dim">{group.rows.length}</span>
		</span>
	);
	if (group.closed !== true)
		return (
			<section className="flex flex-col gap-1">
				<h2 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5">{title}</h2>
				{rows}
			</section>
		);
	return (
		<Collapsible className="flex flex-col gap-1">
			<CollapsibleTrigger className="group/closed flex w-fit items-center gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
				{title}
				<Icon
					icon={ArrowDown01Icon}
					className="size-3.5 text-dim transition-transform group-aria-expanded/closed:rotate-180"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent>{rows}</CollapsibleContent>
		</Collapsible>
	);
}

function SessionRow({
	row,
	current,
	now,
	showMachine,
	showFolder,
}: {
	row: Row;
	current: boolean;
	now: number;
	showMachine: boolean;
	showFolder: boolean;
}): ReactNode {
	const scheme = useScheme();
	const color = piColor(scheme, row.color);
	const doing = doingOf(row.activity, statusOf(row), row.mark === "waits");
	return (
		<Link
			to={`/session/${encodeURIComponent(row.machine)}/${encodeURIComponent(row.session)}`}
			aria-current={current ? "page" : undefined}
			className={cn(
				"flex gap-2.5 rounded-xl px-2.5 py-2.5 outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50",
				current && "bg-muted",
				row.mark === "closed" && "opacity-70",
			)}
		>
			<StatusMark mark={row.mark} className="mt-[3px]" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-baseline gap-2">
					<AgentName name={row.name} color={color} className="text-[15px]" />
					{showFolder ? (
						<span className="min-w-0 truncate text-[13px] text-muted-foreground">{row.folder}</span>
					) : null}
					{row.at === undefined ? null : (
						<time className="tabular ms-auto shrink-0 text-xs text-dim">{ago(row.at, now)}</time>
					)}
				</div>
				<Second row={row} doing={doing} />
				<div className="flex min-w-0 items-center gap-x-2.5 font-mono text-[11.5px] text-dim">
					{row.branch === undefined ? null : (
						<span className="flex min-w-0 items-center gap-1">
							<Icon icon={GitBranchIcon} className="size-3" />
							<span className="truncate">{row.branch}</span>
						</span>
					)}
					{showMachine ? (
						<span className="flex shrink-0 items-center gap-1">
							<Icon icon={ComputerIcon} className="size-3" />
							{row.machine}
						</span>
					) : null}
					{row.context === undefined ? null : (
						<span className="tabular shrink-0">{Math.round(row.context * 100)}% ctx</span>
					)}
					{row.cost === "" ? null : <span className="tabular shrink-0">{row.cost}</span>}
				</div>
			</div>
		</Link>
	);
}

function Second({ row, doing }: { row: Row; doing: ReturnType<typeof doingOf> }): ReactNode {
	if (row.asks !== undefined)
		return (
			<span className="flex min-w-0 items-center gap-1.5 text-[13px] text-waits">
				<Icon icon={HelpCircleIcon} className="size-3.5" />
				<span className="truncate">{row.asks}</span>
			</span>
		);
	if (row.mark === "working") return <DoingLine doing={doing} />;
	if (row.said !== undefined)
		return <span className="truncate text-[13px] text-muted-foreground">{row.said}</span>;
	return <DoingLine doing={doing} className="text-muted-foreground" />;
}

function statusOf(row: Row): "working" | "done" | "error" | "idle" {
	if (row.mark === "working") return "working";
	if (row.mark === "error") return "error";
	return row.word === "done" ? "done" : "idle";
}

function ListSkeleton(): ReactNode {
	return (
		<div className="flex flex-col gap-2 pt-7" aria-hidden="true">
			{[0, 1, 2].map((one) => (
				<div key={one} className="flex gap-2.5 px-2.5 py-2.5">
					<span className="mt-1 size-3 rounded-full bg-muted" />
					<div className="flex flex-1 flex-col gap-2">
						<span className="h-3.5 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
						<span className="h-3 w-3/4 rounded bg-muted/70 motion-safe:animate-pulse" />
					</div>
				</div>
			))}
		</div>
	);
}
