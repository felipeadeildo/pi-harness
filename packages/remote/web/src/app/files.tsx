// A session's folder, read only: what changed since the last commit, with each file's diff, and the
// folder's files. Where the screen stands lives in the address, so the back button walks it.
import type {
	Changes as ChangeList,
	ChangedFile,
	FileDiff,
	FileView,
	Folder,
	FolderEntry,
} from "@adeildo/pi-remote-protocol";
import {
	type FolderOf,
	readChanges,
	readDiff,
	readFile,
	readFolder,
} from "@adeildo/pi-remote-protocol/client";
import {
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	File01Icon,
	Folder01Icon,
	Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { browserSource } from "@/session/browser.ts";
import {
	changesLine,
	childOf,
	crumbsOf,
	type FilesPlace,
	filesHref,
	HIGHLIGHT_BYTES,
	nameOf,
	parentOf,
	placeOf,
	sessionHref,
	sizeText,
	STATUS_MARKS,
	totalsOf,
	whyOf,
} from "@/session/files-data.ts";
import { folderOf, shortPath } from "@/session/format.ts";

import { Code, languageOfPath } from "./code.tsx";
import { Icon } from "./kit.tsx";
import { useSessions } from "./list.tsx";

const Diff = lazy(() => import("./diff.tsx"));

export function Component(): ReactNode {
	const { machine = "", id = "" } = useParams();
	const [search] = useSearchParams();
	const place = placeOf(search);
	const of = useMemo(() => ({ machine, session: id }), [machine, id]);
	// The folder's name, from the list: this screen may open before the session's own screen did.
	const listed = useSessions().sessions?.find(
		(one) => one.machine === machine && one.session === id,
	);
	const cwd = listed?.summary?.cwd ?? listed?.live.cwd;
	const name = (cwd === undefined ? "" : folderOf(cwd)) || "Files";

	return (
		<main className="flex h-full min-w-0 flex-1 flex-col">
			<header className="flex shrink-0 items-center gap-1.5 px-2 pt-2 sm:px-4">
				<Button
					variant="ghost"
					size="icon"
					className="size-10"
					aria-label="Back to the session"
					nativeButton={false}
					render={<Link to={sessionHref(of)} />}
				>
					<Icon icon={ArrowLeft01Icon} className="size-5" />
				</Button>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h1 className="wide truncate text-[16px] leading-tight font-semibold">{name}</h1>
					{cwd === undefined ? null : (
						<p className="truncate font-mono text-[11.5px] text-dim" title={cwd} translate="no">
							{shortPath(cwd)}
						</p>
					)}
				</div>
			</header>
			<nav aria-label="Folder views" className="flex shrink-0 gap-1 border-b px-3 pt-2 sm:px-5">
				<Tab to={filesHref(of, { tab: "changes", path: "" })} on={place.tab === "changes"}>
					Changes
				</Tab>
				<Tab to={filesHref(of, { tab: "tree", path: place.path })} on={place.tab === "tree"}>
					Files
				</Tab>
			</nav>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
					<Place place={place} of={of} name={name} />
				</div>
			</div>
		</main>
	);
}

function Place({ place, of, name }: { place: FilesPlace; of: FolderOf; name: string }): ReactNode {
	if (place.tab === "changes") return <Changes of={of} />;
	// Keyed, so another folder or file never shows the last one's content while it loads.
	if (place.file === undefined)
		return <FolderList key={place.path} of={of} path={place.path} name={name} />;
	return <OpenFile key={place.file} of={of} path={place.file} name={name} />;
}

function Tab({ to, on, children }: { to: string; on: boolean; children: ReactNode }): ReactNode {
	return (
		<Link
			to={to}
			aria-current={on ? "page" : undefined}
			className={cn(
				"-mb-px border-b-2 px-3 py-2 text-[14px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
				on
					? "border-pi text-foreground"
					: "border-transparent text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</Link>
	);
}

type Read<T> = { value: T; why?: undefined } | { value?: undefined; why: string } | undefined;

/** One read after the login, again when `again` is called; a later read keeps the last value. */
function useRead<T>(read: () => Promise<T>, what: string): [Read<T>, () => void] {
	const [state, setState] = useState<Read<T>>(undefined);
	const [round, setRound] = useState(0);
	useEffect(() => {
		let open = true;
		void browserSource()
			.then((ready) => {
				if (ready.why !== undefined) throw new Error(ready.why);
				return read();
			})
			.then(
				(value) => open && setState({ value }),
				(error: unknown) => open && setState({ why: whyOf(error, what) }),
			);
		return () => {
			open = false;
		};
	}, [read, what, round]);
	return [state, useCallback(() => setRound((one) => one + 1), [])];
}

function Changes({ of }: { of: FolderOf }): ReactNode {
	const read = useCallback(() => readChanges(location.origin, of), [of]);
	const [changes, again] = useRead<ChangeList>(read, "the changes");
	return (
		<Loaded state={changes} again={again} reading="Reading the changes…">
			{(value) =>
				value.repo ? (
					<ChangeFiles of={of} files={value.files} more={value.more === true} again={again} />
				) : (
					<Quiet>This folder is not in a git repository.</Quiet>
				)
			}
		</Loaded>
	);
}

function ChangeFiles({
	of,
	files,
	more,
	again,
}: {
	of: FolderOf;
	files: ChangedFile[];
	more: boolean;
	again: () => void;
}): ReactNode {
	const totals = totalsOf(files);
	return (
		<>
			<div className="flex items-center gap-3 px-1">
				<p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
					{changesLine(files.length, more)}
					{files.length === 0 ? null : (
						<Counts added={totals.added} removed={totals.removed} className="ml-2" />
					)}
				</p>
				<Button variant="ghost" size="icon" aria-label="Read the changes again" onClick={again}>
					<Icon icon={Refresh01Icon} />
				</Button>
			</div>
			<ul className="flex flex-col gap-1.5">
				{files.map((file) => (
					<li key={file.path} className={LONG_LIST_ROW}>
						<ChangeRow of={of} file={file} />
					</li>
				))}
			</ul>
		</>
	);
}

function ChangeRow({ of, file }: { of: FolderOf; file: ChangedFile }): ReactNode {
	const [open, setOpen] = useState(false);
	const mark = STATUS_MARKS[file.status];
	const folder = parentOf(file.path);
	return (
		<div className="overflow-hidden rounded-lg border">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((was) => !was)}
				className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<Icon
					icon={open ? ArrowDown01Icon : ArrowRight01Icon}
					className="size-3.5 text-muted-foreground"
				/>
				<span
					aria-hidden
					title={mark.label}
					className={cn(
						"w-3 shrink-0 text-center font-mono text-[12px] font-semibold",
						TONES[mark.tone],
					)}
				>
					{mark.letter}
				</span>
				<span className="sr-only">{mark.label}:</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5" title={file.path} translate="no">
					<span
						className={cn(
							"truncate font-mono text-[13.5px]",
							file.status === "deleted" && "line-through decoration-dim",
						)}
					>
						{nameOf(file.path)}
					</span>
					{folder === "" && file.from === undefined ? null : (
						<span className="truncate font-mono text-[11.5px] text-dim">
							{file.from === undefined ? folder : `from ${file.from}`}
						</span>
					)}
				</span>
				{file.added === undefined ? (
					<span className="shrink-0 text-[12px] text-dim">binary</span>
				) : (
					<Counts added={file.added} removed={file.removed ?? 0} />
				)}
			</button>
			{open ? (
				<div className="flex flex-col gap-2 border-t px-2 py-2">
					<FileDiffBox of={of} path={file.path} />
					{file.status === "deleted" ? null : (
						<Link
							to={filesHref(of, { tab: "tree", path: folder, file: file.path })}
							className="self-end px-1 text-[12.5px] text-pi underline-offset-4 hover:underline"
						>
							Open the file
						</Link>
					)}
				</div>
			) : null}
		</div>
	);
}

/** A side that is zero is left out, so a new file reads `+12` and a cut one `−4`. */
function Counts({
	added,
	removed,
	className,
}: {
	added: number;
	removed: number;
	className?: string;
}): ReactNode {
	return (
		<span className={cn("tabular inline-flex shrink-0 gap-1.5 font-mono text-[12px]", className)}>
			{added === 0 && removed !== 0 ? null : <span className="text-added">+{added}</span>}
			{removed === 0 ? null : <span className="text-removed">−{removed}</span>}
		</span>
	);
}

/** Up to thousands of rows: the browser skips drawing the ones off screen. */
const LONG_LIST_ROW = "[contain-intrinsic-size:auto_2.75rem] [content-visibility:auto]";

const TONES = {
	added: "text-added",
	removed: "text-removed",
	changed: "text-waits",
	conflict: "text-destructive",
} as const;

function FileDiffBox({ of, path }: { of: FolderOf; path: string }): ReactNode {
	const read = useCallback(() => readDiff(location.origin, of, path), [of, path]);
	const [diff, again] = useRead<FileDiff>(read, "the diff");
	return (
		<Loaded state={diff} again={again} reading="Reading the diff…">
			{(value) => <Patch diff={value} />}
		</Loaded>
	);
}

function Patch({ diff }: { diff: FileDiff }): ReactNode {
	if (diff.patch === "") return <Quiet>No difference in the text.</Quiet>;
	return (
		<>
			<Suspense fallback={<Code code={diff.patch} language="diff" size="sm" />}>
				<Diff patch={diff.patch} />
			</Suspense>
			{diff.truncated === true ? (
				<Quiet>The diff is too long, and only its start is shown.</Quiet>
			) : null}
		</>
	);
}

function FolderList({ of, path, name }: { of: FolderOf; path: string; name: string }): ReactNode {
	const read = useCallback(() => readFolder(location.origin, of, path), [of, path]);
	const [folder, again] = useRead<Folder>(read, "the folder");
	return (
		<>
			<Crumbs of={of} name={name} path={path} />
			<Loaded state={folder} again={again} reading="Reading the folder…">
				{(value) => <Entries of={of} folder={value} />}
			</Loaded>
		</>
	);
}

function Entries({ of, folder }: { of: FolderOf; folder: Folder }): ReactNode {
	if (folder.entries.length === 0) return <Quiet>This folder is empty.</Quiet>;
	return (
		<ul className="flex flex-col">
			{folder.entries.map((entry) => (
				<li key={entry.name} className={LONG_LIST_ROW}>
					<EntryRow of={of} entry={entry} at={childOf(folder.path, entry.name)} />
				</li>
			))}
			{folder.more === true ? (
				<li>
					<Quiet>More entries than fit here; the first ones by name are shown.</Quiet>
				</li>
			) : null}
		</ul>
	);
}

function EntryRow({ of, entry, at }: { of: FolderOf; entry: FolderEntry; at: string }): ReactNode {
	const dir = entry.kind === "dir";
	return (
		<Link
			to={filesHref(
				of,
				dir ? { tab: "tree", path: at } : { tab: "tree", path: parentOf(at), file: at },
			)}
			className={cn(
				"flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50",
				entry.ignored === true && "opacity-55",
			)}
		>
			<Icon
				icon={dir ? Folder01Icon : File01Icon}
				className={cn("size-4", dir ? "text-pi" : "text-muted-foreground")}
			/>
			<span className="min-w-0 flex-1 truncate font-mono text-[13.5px]" translate="no">
				{entry.name}
			</span>
			{entry.ignored === true ? <span className="sr-only">, ignored by git</span> : null}
			{entry.size === undefined ? null : (
				<span className="tabular shrink-0 font-mono text-[11.5px] text-dim">
					{sizeText(entry.size)}
				</span>
			)}
		</Link>
	);
}

function OpenFile({ of, path, name }: { of: FolderOf; path: string; name: string }): ReactNode {
	const read = useCallback(() => readFile(location.origin, of, path), [of, path]);
	const [file, again] = useRead<FileView>(read, "the file");
	return (
		<>
			<Crumbs of={of} name={name} path={path} file />
			<Loaded state={file} again={again} reading="Reading the file…">
				{(value) => <FileText file={value} />}
			</Loaded>
		</>
	);
}

function FileText({ file }: { file: FileView }): ReactNode {
	if (file.kind === "binary")
		return <Quiet>A binary file of {sizeText(file.size)}, which is not shown.</Quiet>;
	return (
		<>
			<Code
				code={file.text}
				language={file.size > HIGHLIGHT_BYTES ? "text" : languageOfPath(file.path)}
				numbered
				size="sm"
				maxHeight="max-h-none"
			/>
			{file.truncated === true ? (
				<Quiet>The file has {sizeText(file.size)}, and only its start is shown.</Quiet>
			) : null}
		</>
	);
}

/** The folder's name, then each folder on the way; the open file's name is the last step. */
function Crumbs({
	of,
	name,
	path,
	file = false,
}: {
	of: FolderOf;
	name: string;
	path: string;
	file?: boolean;
}): ReactNode {
	const crumbs = crumbsOf(name, path);
	return (
		<nav
			aria-label="Path"
			translate="no"
			className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 px-1 font-mono text-[12.5px]"
		>
			{crumbs.map((crumb, index) => {
				const last = index === crumbs.length - 1;
				return (
					<span key={crumb.path} className="flex min-w-0 items-center gap-1">
						{index === 0 ? null : (
							<span aria-hidden className="text-dim">
								/
							</span>
						)}
						{last && (file || index > 0) ? (
							<span className="truncate font-semibold text-foreground" aria-current="page">
								{crumb.name}
							</span>
						) : (
							<Link
								to={filesHref(of, { tab: "tree", path: crumb.path })}
								className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
							>
								{crumb.name}
							</Link>
						)}
					</span>
				);
			})}
		</nav>
	);
}

/** What a read draws while it runs and when it fails; `children` draws what it read. */
function Loaded<T>({
	state,
	again,
	reading,
	children,
}: {
	state: Read<T>;
	again: () => void;
	reading: string;
	children: (value: T) => ReactNode;
}): ReactNode {
	if (state === undefined) return <Quiet>{reading}</Quiet>;
	if (state.why !== undefined) return <Failed why={state.why} again={again} />;
	return children(state.value);
}

function Quiet({ children }: { children: ReactNode }): ReactNode {
	return <p className="px-1 py-2 text-[13px] text-muted-foreground">{children}</p>;
}

function Failed({ why, again }: { why: string; again: () => void }): ReactNode {
	return (
		<div className="flex items-center gap-3 px-1 py-2">
			<p className="min-w-0 flex-1 text-[13px] text-destructive">{why}</p>
			<Button variant="outline" size="sm" onClick={again}>
				Try again
			</Button>
		</div>
	);
}
