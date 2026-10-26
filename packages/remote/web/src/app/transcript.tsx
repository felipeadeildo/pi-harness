// The conversation. It follows what arrives while the reader is at the end, and stays put once they
// scroll up; a button brings them back.
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";
import { AlertCircleIcon, ComputerTerminal01Icon } from "@hugeicons/core-free-icons";
import { memo, type ReactNode, useMemo } from "react";

import { Marker, MarkerContent } from "@/components/ui/marker";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { viewOf } from "@/session/session-view.ts";
import { type Block, blocksOf, liveBlocksOf } from "@/session/turns.ts";

import { Clamp, isLong } from "./clamp.tsx";
import { Code } from "./code.tsx";
import { Icon } from "./kit.tsx";
import { Markdown } from "./markdown.tsx";
import { SkillsLoaded } from "./skills.tsx";
import { RunningTools, SessionFolder, Steps } from "./steps.tsx";

export function Transcript({
	session,
	footer,
}: {
	session: ClientSession;
	footer?: ReactNode;
}): ReactNode {
	const { items, state } = viewOf(session);
	const thought = session.live.thought;
	const written = useMemo(
		() => blocksOf(items, state.promptFrom, thought),
		[items, state.promptFrom, thought],
	);
	const live = useMemo(() => liveBlocksOf(session.live), [session.live]);
	const blocks = useMemo(() => joined(written, live), [written, live]);
	// The turn under way starts at the last thing you said; what came before reads as history.
	const turn = blocks.findLastIndex((block) => block.kind === "you");
	return (
		<SessionFolder.Provider value={session.summary?.cwd}>
			<RunningTools.Provider value={session.live.tools}>
				<MessageScrollerProvider autoScroll defaultScrollPosition="end">
					<MessageScroller className="min-h-0 flex-1">
						<MessageScrollerViewport>
							<MessageScrollerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-4 pb-8 sm:px-6">
								{blocks.length === 0 ? (
									<p className="py-16 text-center text-sm text-muted-foreground">
										Nothing said yet.
									</p>
								) : null}
								{blocks.map((block, index) => (
									<MessageScrollerItem
										key={block.id}
										messageId={block.id}
										scrollAnchor={block.kind === "you"}
										className="[content-visibility:visible]"
									>
										<BlockView block={block} current={index > turn} />
									</MessageScrollerItem>
								))}
								{footer}
							</MessageScrollerContent>
						</MessageScrollerViewport>
						<MessageScrollerButton />
					</MessageScroller>
				</MessageScrollerProvider>
			</RunningTools.Provider>
		</SessionFolder.Provider>
	);
}

/**
 * What is being written continues the run of steps above it, in the same block, so the run does not
 * jump when pi writes the message down.
 */
function joined(written: readonly Block[], live: readonly Block[]): Block[] {
	const blocks = [...written];
	for (const block of live) {
		const last = blocks.at(-1);
		if (block.kind !== "steps") blocks.push(block);
		else if (last?.kind === "steps")
			blocks[blocks.length - 1] = { ...last, lines: [...last.lines, ...block.lines] };
		// The id it will have once written, so the block is not drawn again then.
		else blocks.push({ ...block, id: `steps-${blocks.length}` });
	}
	return blocks;
}

const BlockView = memo(function BlockView({
	block,
	current,
}: {
	block: Block;
	current: boolean;
}): ReactNode {
	switch (block.kind) {
		case "you":
			return (
				<div
					data-block="you"
					className="remote-you ml-auto flex max-w-[88%] min-w-0 flex-col items-end gap-1"
				>
					<div className="flex items-center gap-1.5 text-[11.5px] text-dim">
						<span className="remote-who font-medium text-pi">You</span>
						{block.origin === undefined ? null : (
							<span className="remote-from">{block.origin}</span>
						)}
						{block.at === undefined ? null : <time className="tabular">{clock(block.at)}</time>}
					</div>
					<div className="max-w-full min-w-0 rounded-2xl rounded-tr-md bg-secondary px-3.5 py-2.5 [overflow-wrap:anywhere] [&_.prose-pi]:text-[14.5px]">
						<Clamp long={isLong(block.text)}>
							<Markdown text={block.text} />
						</Clamp>
					</div>
				</div>
			);
		case "text":
			return (
				<div
					data-block="text"
					className={
						block.streaming
							? "[&_.prose-pi>*:last-child]:after:ml-0.5 [&_.prose-pi>*:last-child]:after:inline-block [&_.prose-pi>*:last-child]:after:h-[1.05em] [&_.prose-pi>*:last-child]:after:w-[2px] [&_.prose-pi>*:last-child]:after:translate-y-[2px] [&_.prose-pi>*:last-child]:after:bg-pi [&_.prose-pi>*:last-child]:after:content-[''] motion-safe:[&_.prose-pi>*:last-child]:after:animate-pulse"
							: undefined
					}
				>
					<Markdown text={block.text} streaming={block.streaming} />
				</div>
			);
		case "steps":
			return <Steps lines={block.lines} current={current} />;
		case "shell":
			return (
				<Code
					code={block.output === "" ? "(no output)" : block.output}
					language="ansi"
					size="sm"
					title={
						<span className="flex items-center gap-1.5">
							<Icon icon={ComputerTerminal01Icon} className="size-3.5" />
							{block.command}
							{block.exit === undefined || block.exit === 0 ? null : (
								<span className="text-destructive">exit {block.exit}</span>
							)}
						</span>
					}
					variant={block.exit === undefined || block.exit === 0 ? "default" : "destructive"}
				/>
			);
		case "skills":
			return <SkillsLoaded skills={block.skills} />;
		case "note":
			return (
				<Marker variant="separator">
					<MarkerContent className="max-w-[70%] truncate">
						{block.label}
						{block.text === "" ? null : (
							<span className="text-dim"> · {block.text.split("\n")[0]}</span>
						)}
					</MarkerContent>
				</Marker>
			);
		case "error":
			return (
				<div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
					<Icon icon={AlertCircleIcon} className="mt-0.5" />
					<p className="min-w-0 break-words">{block.text}</p>
				</div>
			);
	}
});

function clock(at: string): string {
	const date = new Date(at);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
