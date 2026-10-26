// The agent's questions, answered from here: one question at a time, every option with its
// description and its preview, a note on any option, and words of your own.
import type { AskOption, OpenAsk } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";
import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	CheckmarkCircle02Icon,
	HelpCircleIcon,
	Note01Icon,
	SentIcon,
	Tick02Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { answerAsk, type Draft, EMPTY, note, pick, ready, type } from "@/session/answers.ts";
import { plain } from "@/session/plain.ts";

import { Icon, useWide } from "./kit.tsx";

const RECOMMENDED = /\s*\((recommended|recomendad[oa])\)\s*$/i;

export function QuestionPanel({
	ask,
	client,
	asker,
}: {
	ask: OpenAsk;
	client: Client;
	asker: ReactNode;
}): ReactNode {
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [index, setIndex] = useState(0);
	const [looking, setLooking] = useState<string | undefined>(undefined);
	const wide = useWide();
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
			className="flex max-h-[min(78dvh,46rem)] flex-col overflow-hidden rounded-2xl border bg-card shadow-lg"
		>
			<header className="flex items-center gap-2 border-b px-4 py-2.5">
				<Icon icon={HelpCircleIcon} className="text-waits" />
				<span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{asker} asks</span>
				<span className="tabular text-xs text-dim">
					{index + 1} of {ask.questions.length}
				</span>
			</header>
			{ask.questions.length > 1 ? (
				<nav
					aria-label="Questions"
					className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 no-scrollbar"
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
								"flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs transition-colors",
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
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div
					className={cn(
						"flex flex-col gap-4 p-4",
						wide && previews && "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start",
					)}
				>
					<div className="flex min-w-0 flex-col gap-3">
						<h2 className="wide text-[17px] leading-snug font-semibold text-pretty">
							{plain(one.question)}
						</h2>
						{one.multiSelect === true ? (
							<p className="-mt-2 text-xs text-muted-foreground">Pick any that apply.</p>
						) : null}
						<div className="flex flex-col gap-2">
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
								rows={2}
								value={draft.typed[index] ?? ""}
								onChange={(event) => setDraft((was) => type(was, index, event.target.value))}
								className="min-h-11 w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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

			<footer className="flex items-center gap-2 border-t px-4 py-2.5">
				{index === 0 ? (
					<span className="flex-1" />
				) : (
					<Button variant="ghost" onClick={() => setIndex(index - 1)} className="h-10">
						<Icon icon={ArrowLeft01Icon} />
						Back
					</Button>
				)}
				<span className="flex-1" />
				{last ? (
					<Button
						disabled={!ready(ask, draft)}
						onClick={() => answerAsk(client, ask, draft)}
						className="h-10 rounded-full px-4"
						aria-label="Send answer"
					>
						<Icon icon={SentIcon} />
						Send answer
					</Button>
				) : (
					<Button
						variant={answered(index) ? "default" : "secondary"}
						onClick={() => {
							setIndex(index + 1);
							setLooking(undefined);
						}}
						className="h-10 rounded-full px-4"
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
			<button
				type="button"
				aria-pressed={chosen}
				onClick={onPick}
				onFocus={onLook}
				className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-[15px] font-semibold">{name}</span>
						{recommended ? (
							<Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[11px] text-ok">
								<Icon icon={CheckmarkCircle02Icon} className="size-3" />
								Recommended
							</Badge>
						) : null}
					</span>
					{option.description === undefined ? null : (
						<span className="text-[13.5px] leading-snug text-muted-foreground">
							{plain(option.description)}
						</span>
					)}
				</span>
			</button>
			<div className="flex items-center gap-1 px-2 pb-1.5 empty:hidden">
				{option.preview !== undefined && previewInline ? (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 text-muted-foreground"
						onClick={() => setPreviewing(!previewing)}
						aria-expanded={previewing}
					>
						<Icon icon={ViewIcon} className="size-3.5" />
						{previewing ? "Hide preview" : "Preview"}
					</Button>
				) : null}
				{noting ? null : (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 text-muted-foreground"
						onClick={() => setNoting(true)}
					>
						<Icon icon={Note01Icon} className="size-3.5" />
						Add a note
					</Button>
				)}
			</div>
			{previewing && previewInline ? (
				<div className="px-3 pb-3">
					<Preview option={option} />
				</div>
			) : null}
			{noting ? (
				<div className="px-3 pb-3">
					<input
						type="text"
						autoFocus={said === ""}
						aria-label={`A note on ${name}`}
						placeholder={chosen ? "Why this one" : "Why not, or what would change your mind"}
						value={said}
						onChange={(event) => onNote(event.target.value)}
						className="h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
