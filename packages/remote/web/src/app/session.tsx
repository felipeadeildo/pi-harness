// One session: who it is and what it does at the top, the conversation, then the field. A question
// from the agent takes the field's place until it is answered.
import { openQuestions } from "@adeildo/pi-remote-protocol";
import {
	ArrowLeft01Icon,
	ComputerTerminal01Icon,
	Folder01Icon,
	GitBranchIcon,
	InformationCircleIcon,
	KanbanIcon,
	WifiDisconnected01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { browserSource } from "@/session/browser.ts";
import { contextShare, folderOf, shortPath } from "@/session/format.ts";
import { agentsNear, listedOf } from "@/session/listed.ts";
import { composerOf } from "@/session/live.ts";
import { terminalWait } from "@/session/panel-data.ts";
import { plain } from "@/session/plain.ts";
import { type Mark, markFor } from "@/session/rows.ts";
import { statusOf, titleOf, viewOf } from "@/session/session-view.ts";
import { useSession } from "@/session/use-session.ts";
import { piColor } from "@/ui/pi-colors.ts";
import { useScheme } from "@/ui/use-scheme.ts";

import { DoingLine, doingOf } from "./activity.tsx";
import { Board, openCards } from "./board.tsx";
import { Composer } from "./composer.tsx";
import { Details } from "./details.tsx";
import { AgentName, Icon, Panel, useWide } from "./kit.tsx";
import { FoldedQuestion, QuestionPanel } from "./question.tsx";
import { Transcript } from "./transcript.tsx";

type Side = "board" | "details" | undefined;

export function Component(): ReactNode {
	const { machine = "", id = "" } = useParams();
	const scheme = useScheme();
	const { session, client, why } = useSession({ machine, session: id }, browserSource);
	const [side, setSide] = useState<Side>(undefined);
	// On a phone an open question takes the screen; folded, it is a bar over the conversation.
	const [folded, fold] = useState<string | undefined>(undefined);
	const wide = useWide();

	if (why !== undefined)
		return (
			<main className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
				<Icon icon={WifiDisconnected01Icon} className="size-6 text-dim" />
				<p className="max-w-sm text-sm text-muted-foreground">{why}</p>
				<Link to="/" className="text-sm text-pi underline underline-offset-4">
					All sessions
				</Link>
			</main>
		);
	if (session === undefined || client === undefined) return <main className="h-full" />;

	const { state } = viewOf(session);
	const asked = openQuestions(state)[0];
	const listed = listedOf(machine, id);
	const name = plain(titleOf(session, listed));
	const color = piColor(scheme, state.theme?.color);
	const status = statusOf(session, listed);
	const waits = asked !== undefined || status === "blocked";
	const activity = state.activity ?? listed?.state.activity;
	const doing = doingOf(activity, status, waits);
	const mark = markFor(status, waits);
	const cards = openCards(state.board);
	const wait = terminalWait(state.prompt);
	const cwd = session.summary?.cwd ?? listed?.summary?.cwd ?? listed?.live.cwd;
	const branch = state.branch ?? listed?.state.branch;
	const takeover = asked !== undefined && !wide && folded !== asked.id;

	return (
		<div className="flex h-full min-w-0 flex-1">
			<main className="flex h-full min-w-0 flex-1 flex-col">
				<header className="relative flex shrink-0 items-center gap-1.5 px-2 py-2 sm:px-4 lg:gap-3">
					<Button
						variant="ghost"
						size="icon"
						className="size-10 lg:hidden"
						aria-label="All sessions"
						nativeButton={false}
						render={<Link to="/" />}
					>
						<Icon icon={ArrowLeft01Icon} className="size-5" />
					</Button>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<h1 className="truncate text-[16px] leading-tight font-semibold">
							<AgentName name={name} color={color} />
						</h1>
						<div className="flex min-w-0 items-center gap-2.5 overflow-hidden text-[12.5px] text-muted-foreground">
							<DoingLine doing={doing} className="min-w-0 shrink overflow-hidden" />
							{cwd === undefined ? null : (
								<span
									className={cn(
										"shrink-0 items-center gap-1 text-dim",
										doing.live ? "hidden sm:flex" : "flex",
									)}
									title={cwd}
								>
									<Icon icon={Folder01Icon} className="size-3.5" />
									<span className="sm:hidden">{folderOf(cwd)}</span>
									<span className="hidden sm:inline">{shortPath(cwd)}</span>
								</span>
							)}
							{branch === undefined ? null : (
								<span
									className={cn(
										"min-w-0 shrink items-center gap-1 text-dim",
										doing.live ? "hidden md:flex" : "flex",
									)}
								>
									<Icon icon={GitBranchIcon} className="size-3.5" />
									<span className="truncate">{branch}</span>
								</span>
							)}
						</div>
					</div>
					<Button
						variant="ghost"
						className="relative h-10 gap-1.5 px-2.5"
						aria-label={cards === 0 ? "Board" : `Board, ${cards} open`}
						onClick={() => setSide("board")}
					>
						<Icon icon={KanbanIcon} className="size-[18px]" />
						<span className="hidden text-[13px] sm:inline">Board</span>
						{cards === 0 ? null : (
							<span className="tabular rounded-full bg-secondary px-1.5 text-[11px] font-semibold text-foreground">
								{cards}
							</span>
						)}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-10 min-[1440px]:hidden"
						aria-label="Details"
						onClick={() => setSide("details")}
					>
						<Icon icon={InformationCircleIcon} className="size-[18px]" />
					</Button>
					<Rail
						mark={mark}
						share={contextShare(session.summary?.context ?? listed?.summary?.context)}
						color={color}
					/>
				</header>

				{wait === undefined ? null : (
					<div className="flex shrink-0 items-center gap-2 border-b bg-waits/10 px-4 py-2 text-[13px] text-waits">
						<Icon icon={ComputerTerminal01Icon} className="size-4" />
						<span className="min-w-0 truncate">{wait}</span>
					</div>
				)}

				<div className={cn("flex min-h-0 flex-1 flex-col", takeover && "hidden")}>
					<Transcript session={session} />
				</div>

				<div
					className={cn(
						"px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6",
						takeover ? "flex min-h-0 flex-1 flex-col pt-3" : "shrink-0",
					)}
				>
					<div
						className={cn("mx-auto w-full max-w-3xl", takeover && "flex min-h-0 flex-1 flex-col")}
					>
						{asked === undefined ? null : folded === asked.id ? (
							<FoldedQuestion
								ask={asked}
								asker={<AgentName name={name} color={color} />}
								onOpen={() => fold(undefined)}
							/>
						) : (
							<QuestionPanel
								key={asked.id}
								ask={asked}
								client={client}
								asker={<AgentName name={name} color={color} />}
								fill={takeover}
								{...(wide ? {} : { onFold: () => fold(asked.id) })}
							/>
						)}
						{/* The composer stays mounted behind a question, so the draft is there when it closes. */}
						<div className={cn(asked !== undefined && "hidden")}>
							<Composer
								client={client}
								view={composerOf(session)}
								name={name}
								agents={agentsNear(machine, id)}
								ask={(question) => window.prompt(question) ?? undefined}
							/>
						</div>
					</div>
				</div>
			</main>

			<aside className="hidden h-full w-80 shrink-0 flex-col gap-6 overflow-y-auto border-l px-5 py-5 min-[1440px]:flex">
				<section className="flex flex-col gap-3">
					<h2 className="text-xs font-semibold text-muted-foreground">Session</h2>
					<Details session={session} />
				</section>
				<section className="flex flex-col gap-3">
					<h2 className="text-xs font-semibold text-muted-foreground">Board</h2>
					<Board board={state.board} />
				</section>
			</aside>

			<Panel
				open={side === "board"}
				onOpenChange={(open) => setSide(open ? "board" : undefined)}
				title={`${name}'s board`}
				tall
			>
				<Board board={state.board} />
			</Panel>
			<Panel
				open={side === "details"}
				onOpenChange={(open) => setSide(open ? "details" : undefined)}
				title={name}
			>
				<Details session={session} />
			</Panel>
		</div>
	);
}

/**
 * The header's lower edge: filled as far as the context window is, and swept by the agent's color
 * while it works, amber while it waits on you.
 */
function Rail({
	mark,
	share,
	color,
}: {
	mark: Mark;
	share: number | undefined;
	color: string | undefined;
}): ReactNode {
	const label = share === undefined ? undefined : `Context ${Math.round(share * 100)}% full`;
	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden bg-border"
			{...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
			title={label}
		>
			{share === undefined ? null : (
				<div
					className="absolute inset-y-0 left-0 bg-muted-foreground/45 transition-[width] duration-700"
					style={{ width: `${Math.min(100, share * 100)}%` }}
				/>
			)}
			{mark === "waits" ? <div className="absolute inset-0 bg-waits" /> : null}
			{mark === "working" ? (
				<div
					className="absolute inset-y-0 w-1/3 motion-safe:animate-[rail_1.6s_ease-in-out_infinite] motion-reduce:hidden"
					style={{
						background: `linear-gradient(90deg, transparent, ${color ?? "var(--pi)"}, transparent)`,
					}}
				/>
			) : null}
		</div>
	);
}
