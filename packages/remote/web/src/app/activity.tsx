// What a session does right now, in a line: the list's second line and the session's status.
import type { SessionActivity, SessionState } from "@adeildo/pi-remote-protocol";
import {
	AiBrain01Icon,
	ArchiveIcon,
	CheckmarkCircle02Icon,
	Flag02Icon,
	PencilEdit02Icon,
	PauseCircleIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type { ReactNode } from "react";

import { duration } from "@/session/format.ts";

import { Icon, useNow } from "./kit.tsx";
import { toolIcon } from "./tool-icons.ts";

export interface Doing {
	icon: IconSvgElement;
	verb: string;
	/** A command, a path or a pattern, set in mono. */
	about?: string;
	since?: number;
	live: boolean;
	tone: "pi" | "waits" | "ok" | "error" | "dim";
}

export function doingOf(
	activity: SessionActivity | undefined,
	status: SessionState["status"] | undefined,
	waits: boolean,
	/** The tool whose call the model is writing, which this client sees and the bridge does not name. */
	writing?: string,
): Doing {
	if (waits) return { icon: Flag02Icon, verb: "Waiting on you", live: false, tone: "waits" };
	if (status === "error")
		return { icon: Flag02Icon, verb: "Stopped on an error", live: false, tone: "error" };
	const since = activity?.since;
	const at = since === undefined ? {} : { since };
	if (status === "working" && activity !== undefined) {
		switch (activity.what) {
			case "thinking":
				return { icon: AiBrain01Icon, verb: "Thinking", live: true, tone: "pi", ...at };
			case "writing":
				return writing === undefined
					? { icon: PencilEdit02Icon, verb: "Writing", live: true, tone: "pi", ...at }
					: { icon: toolIcon(writing), verb: `Writing ${writing}`, live: true, tone: "pi", ...at };
			case "compacting":
				return { icon: ArchiveIcon, verb: "Compacting", live: true, tone: "pi", ...at };
			case "tool":
				return {
					icon: toolIcon(activity.tool ?? ""),
					verb: `Running ${activity.tool ?? "a tool"}`,
					...(activity.about === undefined ? {} : { about: activity.about }),
					live: true,
					tone: "pi",
					...at,
				};
			case "resting":
				break;
		}
	}
	if (status === "working")
		return { icon: AiBrain01Icon, verb: "Working", live: true, tone: "pi", ...at };
	if (status === "done")
		return { icon: CheckmarkCircle02Icon, verb: "Done", live: false, tone: "ok", ...at };
	return { icon: PauseCircleIcon, verb: "Idle", live: false, tone: "dim", ...at };
}

const TONE: Record<Doing["tone"], string> = {
	pi: "text-pi",
	waits: "text-waits",
	ok: "text-ok",
	error: "text-destructive",
	dim: "text-dim",
};

export function DoingLine({ doing, className }: { doing: Doing; className?: string }): ReactNode {
	const now = useNow(1000, doing.live);
	return (
		<span className={cn("flex min-w-0 items-center gap-1.5 text-[13px]", className)}>
			<Icon icon={doing.icon} className={cn("size-3.5", TONE[doing.tone])} />
			<span
				className={cn("shrink-0 font-medium", doing.live && "shimmer motion-reduce:shimmer-none")}
			>
				{doing.verb}
			</span>
			{doing.about === undefined ? null : (
				<span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">
					{doing.about}
				</span>
			)}
			{doing.live && doing.since !== undefined ? (
				<span className="tabular shrink-0 font-mono text-[11.5px] text-dim">
					{duration(Math.max(0, now - doing.since))}
				</span>
			) : null}
		</span>
	);
}
