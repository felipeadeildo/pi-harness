// The agent's questions, answered from here: one question at a time, every option with its
// description and its preview, a note on any option, and words of your own.
import type { AskOption, OpenAsk } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";
import {
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	HelpCircleIcon,
	CommentAdd01Icon,
	SentIcon,
	Tick02Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { answerAsk, type Draft, EMPTY, note, pick, ready, type } from "@/session/answers.ts";
import { plain } from "@/session/plain.ts";

import { Icon, useWide } from "./kit.tsx";

const RECOMMENDED = /\s*\((recommended|recomendad[oa])\)\s*$/i;

export function QuestionPanel({
	ask,
	client,
	fill = false,
	onFold,
}: {
	ask: OpenAsk;
	client: Client;
	/** Takes the screen's height, as on a phone where the question is the whole task. */
	fill?: boolean;
	/** Folds the question to a bar, to read the conversation. */
	onFold?: () => void;
}): ReactNode {
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [index, setIndex] = useState(0);
	const [looking, setLooking] = useState<string | undefined>(undefined);
	const wide = useWide();
	const tabs = useRef<HTMLElement>(null);
	useEffect(() => {
		tabs.current
			?.querySelector("[aria-current]")
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [index]);
	const one = ask.questions[index];
	if (one === undefined) return null;
	const last = index === ask.questions.length - 1;
	const picks = draft.picks[index] ?? [];
	const shownPreview =
		one.options.find((option) => option.label === looking) ??
		one.options.find((option) => picks.includes(option.label)) ??
		one.options.find((option) => option.preview !== undefined);
	const previews = one.options.some((option) => option.preview !== undefined);
	const answered = (at: number): boolean =>
		(draft.picks[at]?.length ?? 0) > 0 || (draft.typed[at]?.trim() ?? "") !== "";

	return (
		<section
			aria-label="The agent's question"
			className={cn(
				"flex flex-col overflow-hidden bg-card",
				fill ? "min-h-0 flex-1" : "max-h-[min(78dvh,46rem)] rounded-2xl border shadow-lg",
			)}
		>
			<header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1 pl-3">
				<Icon icon={HelpCircleIcon} className="shrink-0 text-waits" />
				{ask.questions.length > 1 ? (
					<nav
						ref={tabs}
						aria-label="Questions"
						className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto no-scrollbar"
					>
						{ask.questions.map((question, at) => (
							<button
								type="button"
								key={`${question.header}-${at}`}
								aria-current={at === index ? "step" : undefined}
								onClick={() => {
									setIndex(at);
									setLooking(undefined);
								}}
								className={cn(
									"flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs transition-colors",
									at === index
										? "bg-secondary font-semibold text-foreground"
										: "text-muted-foreground hover:bg-muted",
								)}
							>
								{answered(at) ? (
									<Icon icon={Tick02Icon} className="size-3.5 text-ok" strokeWidth={2.25} />
								) : null}
								{plain(question.header)}
							</button>
						))}
					</nav>
				) : (
					<span className="min-w-0 flex-1 truncate px-1.5 text-xs font-semibold">
						{plain(one.header)}
					</span>
				)}
				{onFold === undefined ? null : (
					<Button
						variant="ghost"
						size="icon"
						aria-label="Read the conversation"
						className="size-9 shrink-0"
						onClick={onFold}
					>
						<Icon icon={ArrowDown01Icon} />
					</Button>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div
					className={cn(
						"flex flex-col gap-3 p-3 sm:gap-4 sm:p-4",
						wide && previews && "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start",
					)}
				>
					<div className="flex min-w-0 flex-col gap-2.5">
						<h2 className="text-[15px] leading-snug font-semibold text-pretty sm:text-base">
							{plain(one.question)}
						</h2>
						{one.multiSelect === true ? (
							<p className="-mt-2 text-xs text-muted-foreground">Pick any that apply.</p>
						) : null}
						<div className="flex flex-col gap-1.5">
							{one.options.map((option) => (
								<Choice
									key={option.label}
									option={option}
									chosen={picks.includes(option.label)}
									multi={one.multiSelect === true}
									previewInline={!wide}
									note={draft.notes[index]?.[option.label] ?? ""}
									onPick={() => {
										setDraft((was) => pick(was, index, option.label, one.multiSelect));
										setLooking(option.label);
									}}
									onLook={() => setLooking(option.label)}
									onNote={(text) => setDraft((was) => note(was, index, option.label, text))}
								/>
							))}
						</div>
						{one.typed === false ? null : (
							<textarea
								aria-label="Answer in your own words"
								placeholder="Or say it in your own words"
								rows={1}
								value={draft.typed[index] ?? ""}
								onChange={(event) => setDraft((was) => type(was, index, event.target.value))}
								className="max-h-32 min-h-10 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm field-sizing-content outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
							/>
						)}
					</div>
					{wide && previews ? (
						<div className="sticky top-0 min-w-0">
							<Preview option={shownPreview} />
						</div>
					) : null}
				</div>
			</div>

			<footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
				{index === 0 ? (
					<span className="flex-1" />
				) : (
					<Button variant="ghost" onClick={() => setIndex(index - 1)} className="h-9">
						<Icon icon={ArrowLeft01Icon} />
						Back
					</Button>
				)}
				<span className="flex-1" />
				{last ? (
					<Button
						disabled={!ready(ask, draft)}
						onClick={() => answerAsk(client, ask, draft)}
						className="h-9 rounded-full px-4"
						aria-label="Send answer"
					>
						<Icon icon={SentIcon} />
						Send
					</Button>
				) : (
					<Button
						variant={answered(index) ? "default" : "secondary"}
						onClick={() => {
							setIndex(index + 1);
							setLooking(undefined);
						}}
						className="h-9 rounded-full px-4"
					>
						Next
						<Icon icon={ArrowRight01Icon} />
					</Button>
				)}
			</footer>
		</section>
	);
}

function Choice({
	option,
	chosen,
	multi,
	previewInline,
	note: said,
	onPick,
	onLook,
	onNote,
}: {
	option: AskOption;
	chosen: boolean;
	multi: boolean;
	previewInline: boolean;
	note: string;
	onPick: () => void;
	onLook: () => void;
	onNote: (text: string) => void;
}): ReactNode {
	const [noting, setNoting] = useState(said !== "");
	const [previewing, setPreviewing] = useState(false);
	const label = plain(option.label);
	const recommended = RECOMMENDED.test(label);
	const name = label.replace(RECOMMENDED, "");
	return (
		<div
			className={cn(
				"group/choice rounded-xl border transition-colors",
				chosen ? "border-pi/60 bg-pi/[0.06]" : "hover:bg-muted/60",
			)}
			onMouseEnter={onLook}
		>
			<div className="flex items-start">
				<button
					type="button"
					aria-pressed={chosen}
					onClick={onPick}
					onFocus={onLook}
					className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl py-2 pl-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<span
						aria-hidden="true"
						className={cn(
							"mt-0.5 flex size-[18px] shrink-0 items-center justify-center border-[1.5px] transition-colors",
							multi ? "rounded-[5px]" : "rounded-full",
							chosen ? "border-pi bg-pi text-primary-foreground" : "border-input",
						)}
					>
						{chosen ? (
							multi ? (
								<Icon icon={Tick02Icon} className="size-3" strokeWidth={3} />
							) : (
								<span className="size-1.5 rounded-full bg-background" />
							)
						) : null}
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
							<span className="text-sm font-semibold">{name}</span>
							{recommended ? (
								<Badge variant="secondary" className="h-[18px] px-1.5 text-[10.5px] text-ok">
									Recommended
								</Badge>
							) : null}
						</span>
						{option.description === undefined ? null : (
							<span className="text-[13px] leading-snug text-muted-foreground">
								{plain(option.description)}
							</span>
						)}
					</span>
				</button>
				<div className="flex shrink-0 items-center px-1 pt-1">
					{option.preview !== undefined && previewInline ? (
						<Button
							variant="ghost"
							size="icon"
							className={cn("size-8 text-muted-foreground", previewing && "text-foreground")}
							onClick={() => setPreviewing(!previewing)}
							aria-label={previewing ? "Hide preview" : "Preview"}
							aria-expanded={previewing}
						>
							<Icon icon={ViewIcon} className="size-4" />
						</Button>
					) : null}
					{noting ? null : (
						<Button
							variant="ghost"
							size="icon"
							className="size-8 text-muted-foreground"
							onClick={() => setNoting(true)}
							aria-label="Add a note"
						>
							<Icon icon={CommentAdd01Icon} className="size-4" />
						</Button>
					)}
				</div>
			</div>
			{previewing && previewInline ? (
				<div className="px-3 pb-2.5">
					<Preview option={option} />
				</div>
			) : null}
			{noting ? (
				<div className="px-3 pb-2.5">
					<input
						type="text"
						autoFocus={said === ""}
						aria-label={`A note on ${name}`}
						placeholder={chosen ? "Why this one" : "Why not, or what would change your mind"}
						value={said}
						onChange={(event) => onNote(event.target.value)}
						className="h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
					/>
				</div>
			) : null}
		</div>
	);
}

function Preview({ option }: { option: AskOption | undefined }): ReactNode {
	if (option?.preview === undefined)
		return (
			<p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
				No preview for this option.
			</p>
		);
	return (
		<figure className="flex flex-col gap-1.5">
			<figcaption className="truncate text-xs text-muted-foreground">
				{plain(option.label).replace(RECOMMENDED, "")}
			</figcaption>
			<pre className="max-h-[26rem] overflow-auto rounded-xl border bg-raised p-3 font-mono text-[12px] leading-[1.45] whitespace-pre">
				{plain(option.preview)}
			</pre>
		</figure>
	);
}

/** A question folded away: one line that says who asks and opens it again. */
export function FoldedQuestion({
	ask,
	asker,
	onOpen,
}: {
	ask: OpenAsk;
	asker: ReactNode;
	onOpen: () => void;
}): ReactNode {
	const count = ask.questions.length;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-center gap-2 rounded-2xl border border-waits/40 bg-waits/10 px-4 py-3 text-left"
		>
			<Icon icon={HelpCircleIcon} className="text-waits" />
			<span className="min-w-0 flex-1 truncate text-sm">
				{asker} asks {count === 1 ? "a question" : `${count} questions`}
			</span>
			<span className="text-sm font-medium text-waits">Answer</span>
		</button>
	);
}
