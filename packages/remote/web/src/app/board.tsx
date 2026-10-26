// The agent's board, as Alt+T shows it in the terminal: one tab per lane with its count, and the cards
// of the lane you pick. It opens on the first lane with work in it.
import {
	type BoardCard,
	type BoardColumn,
	type BoardView,
	blockedOf,
} from "@adeildo/pi-remote-protocol";
import {
	CheckmarkCircle02Icon,
	Clock01Icon,
	Flag02Icon,
	GitPullRequestIcon,
	InboxIcon,
	KanbanIcon,
	PlayCircleIcon,
	UserSearch01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import { type ReactNode, useState } from "react";

import { ago } from "@/session/format.ts";
import { plain } from "@/session/plain.ts";

import { Icon, useNow } from "./kit.tsx";

type LaneId = Exclude<BoardColumn, "dropped">;

interface Lane {
	id: LaneId;
	title: string;
	icon: IconSvgElement;
	/** Its icon, its count and its cards' rail. */
	tone: string;
	rail: string;
}

const LANES: readonly Lane[] = [
	{ id: "doing", title: "Doing", icon: PlayCircleIcon, tone: "text-pi", rail: "bg-pi" },
	{ id: "review", title: "Review", icon: UserSearch01Icon, tone: "text-waits", rail: "bg-waits" },
	{
		id: "todo",
		title: "Next",
		icon: Clock01Icon,
		tone: "text-foreground",
		rail: "bg-muted-foreground/50",
	},
	{
		id: "backlog",
		title: "Backlog",
		icon: InboxIcon,
		tone: "text-muted-foreground",
		rail: "bg-border",
	},
	{
		id: "done",
		title: "Delivered",
		icon: CheckmarkCircle02Icon,
		tone: "text-ok",
		rail: "bg-ok/70",
	},
];

export function openCards(board: BoardView | undefined): number {
	return board?.open.filter((card) => card.column !== "backlog").length ?? 0;
}

function cardsOf(board: BoardView, lane: LaneId): readonly BoardCard[] {
	if (lane === "done") return board.done.toReversed();
	if (lane === "backlog") return board.waiting ?? [];
	return board.open.filter((card) => card.column === lane);
}

function countOf(board: BoardView, lane: LaneId): number {
	return lane === "backlog" ? board.backlog : cardsOf(board, lane).length;
}

export function Board({ board }: { board: BoardView | undefined }): ReactNode {
	const now = useNow(30_000);
	const first =
		board === undefined
			? "doing"
			: (LANES.find((lane) => countOf(board, lane.id) > 0)?.id ?? "doing");
	const [picked, pick] = useState<LaneId | undefined>(undefined);
	if (board === undefined) return <Empty>This session keeps no board.</Empty>;
	const lane = LANES.find((one) => one.id === (picked ?? first)) ?? LANES[0];
	if (lane === undefined) return null;
	const cards = cardsOf(board, lane.id);
	return (
		<div className="flex flex-col gap-3">
			<div
				role="tablist"
				aria-label="Lanes"
				className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto bg-popover px-1 pb-2 no-scrollbar"
			>
				{LANES.map((one) => {
					const count = countOf(board, one.id);
					const chosen = one.id === lane.id;
					return (
						<button
							type="button"
							role="tab"
							aria-selected={chosen}
							key={one.id}
							onClick={() => pick(one.id)}
							className={cn(
								"flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
								chosen
									? "border-transparent bg-secondary font-semibold"
									: "text-muted-foreground hover:bg-muted",
								count === 0 && !chosen && "opacity-50",
							)}
						>
							<Icon icon={one.icon} className={cn("size-3.5", chosen && one.tone)} />
							{one.title}
							<span className="tabular text-xs font-normal text-dim">{count}</span>
						</button>
					);
				})}
			</div>
			{cards.length === 0 ? (
				<EmptyLane lane={lane} board={board} />
			) : (
				<ul role="tabpanel" aria-label={lane.title} className="flex flex-col gap-2">
					{cards.map((card) => (
						<li key={card.id}>
							<Card card={card} lane={lane} now={now} />
						</li>
					))}
					{lane.id === "backlog" && board.backlog > cards.length ? (
						<li className="px-1 pt-1 text-xs text-muted-foreground">
							{board.backlog - cards.length} more in the backlog. Alt+T in the terminal lists them
							all.
						</li>
					) : null}
				</ul>
			)}
		</div>
	);
}

function EmptyLane({ lane, board }: { lane: Lane; board: BoardView }): ReactNode {
	if (lane.id === "backlog" && board.backlog > 0)
		return (
			<Empty>
				{board.backlog} card{board.backlog === 1 ? "" : "s"} wait in the backlog. The terminal's
				board lists them with Alt+T.
			</Empty>
		);
	const said: Record<LaneId, string> = {
		doing: "Nothing in progress right now.",
		review: "Nothing waits on a review.",
		todo: "Nothing lined up next.",
		backlog: "The backlog is empty.",
		done: "Nothing delivered yet.",
	};
	return <Empty>{said[lane.id]}</Empty>;
}

function Card({ card, lane, now }: { card: BoardCard; lane: Lane; now: number }): ReactNode {
	const blocked = card.blocked === undefined ? undefined : blockedOf(card.blocked, "operator");
	const said = card.column === "done" ? card.result : card.now;
	return (
		<article className="flex overflow-hidden rounded-xl border bg-card">
			<span
				aria-hidden="true"
				className={cn("w-1 shrink-0", blocked === undefined ? lane.rail : "bg-waits")}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-2 px-3.5 py-3">
				<div className="flex items-start gap-3">
					<h4 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-pretty">
						{plain(card.title)}
					</h4>
					<time className="tabular mt-0.5 shrink-0 text-xs text-dim">{ago(card.at, now)}</time>
				</div>
				{said === undefined ? null : (
					<p className="text-[13.5px] leading-relaxed text-muted-foreground">{plain(said)}</p>
				)}
				{blocked === undefined ? null : (
					<p className="flex items-start gap-2 rounded-lg bg-waits/10 px-2.5 py-2 text-[13px] leading-snug text-waits">
						<Icon icon={Flag02Icon} className="mt-0.5 size-3.5" />
						<span className="min-w-0">{plain(blocked)}</span>
					</p>
				)}
				{card.pr === undefined && card.reviewer === undefined ? null : (
					<div className="flex flex-wrap items-center gap-2">
						{card.pr === undefined ? null : (
							<span className="flex h-6 items-center gap-1 rounded-md bg-secondary px-2 font-mono text-[12px]">
								<Icon icon={GitPullRequestIcon} className="size-3.5 text-muted-foreground" />#
								{card.pr}
							</span>
						)}
						{card.reviewer === undefined ? null : (
							<span className="flex h-6 items-center gap-1 rounded-md bg-secondary px-2 text-[12px]">
								<Icon icon={UserSearch01Icon} className="size-3.5 text-muted-foreground" />
								{plain(card.reviewer)}
							</span>
						)}
					</div>
				)}
			</div>
		</article>
	);
}

function Empty({ children }: { children: ReactNode }): ReactNode {
	return (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center">
			<Icon icon={KanbanIcon} className="size-5 text-dim" />
			<p className="max-w-xs text-[13.5px] text-balance text-muted-foreground">{children}</p>
		</div>
	);
}
