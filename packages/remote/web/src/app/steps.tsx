// A run of the agent's steps: each thought and each tool call is one line that opens on what it did.
import type { Live } from "@adeildo/pi-remote-protocol/client";
import {
	AiBrain01Icon,
	AlertCircleIcon,
	ArrowRight01Icon,
	Loading03Icon,
	WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { createContext, lazy, type ReactNode, Suspense, useContext, useState } from "react";

import { duration } from "@/session/format.ts";
import { plain } from "@/session/plain.ts";
import { changesOf, commandTitle, countsOf, firstLine, spanOf } from "@/session/steps.ts";
import { type StepLine, type ThoughtLine, type ToolLine, withRunning } from "@/session/turns.ts";

import { Code, languageOfPath } from "./code.tsx";
import { Icon, Panel, useNow } from "./kit.tsx";
import { Markdown } from "./markdown.tsx";
import { toolIcon } from "./tool-icons.ts";

const Diff = lazy(() => import("./diff.tsx"));

/** The tools still running, so a line pi wrote follows its call without the transcript redrawing. */
export const RunningTools = createContext<Live["tools"]>({});

/** The session's folder, so a path inside it reads from there. */
export const SessionFolder = createContext<string | undefined>(undefined);

function inside(path: string, folder: string | undefined): string {
	if (folder === undefined || path === "") return path;
	const base = folder.endsWith("/") ? folder : `${folder}/`;
	return path.startsWith(base) ? path.slice(base.length) : path;
}

/**
 * A run of steps. The turn under way reads like the terminal: each call a block that shows what it
 * runs and the end of what it prints, at a height that stops growing, so the page does not jump. An
 * earlier turn is one line that opens its steps as a timeline.
 */
export function Steps({
	lines,
	current,
}: {
	lines: readonly StepLine[];
	current: boolean;
}): ReactNode {
	const tools = useContext(RunningTools);
	const shown = lines.map((line) => (line.kind === "tool" ? withRunning(line, tools) : line));
	if (!current) return <Earlier lines={shown} />;
	return (
		<div className="flex flex-col gap-2">
			{shown.map((line) =>
				line.kind === "thought" ? (
					<Thought key={line.id} line={line} />
				) : (
					<Block key={line.id} line={line} />
				),
			)}
		</div>
	);
}

/** An earlier turn's steps: what they did and how long, a tap away from each one. */
function Earlier({ lines }: { lines: readonly StepLine[] }): ReactNode {
	const [open, setOpen] = useState(false);
	const span = spanOf(lines, undefined);
	const failed = lines.some((line) => line.kind === "tool" && line.status === "error");
	const counts = countsOf(lines);
	const thoughts = lines.filter((line) => line.kind === "thought").length;
	const said =
		counts || (thoughts > 0 ? `thought ${thoughts === 1 ? "once" : `${thoughts} times`}` : "");
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="group flex w-full min-w-0 items-center gap-2 rounded-lg py-1 text-left text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<Icon
					icon={failed ? AlertCircleIcon : WorkflowSquare03Icon}
					className={failed ? "text-destructive" : "text-dim"}
				/>
				<span className="shrink-0">
					{span === undefined ? "Worked" : `Worked for ${duration(span)}`}
				</span>
				<span className="min-w-0 truncate text-dim">{said}</span>
				<Icon icon={ArrowRight01Icon} className="ml-auto size-3.5 text-dim" />
			</button>
			<Panel open={open} onOpenChange={setOpen} title="Steps" tall>
				<ol className="relative flex flex-col gap-3 pb-2 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-border">
					{lines.map((line) => (
						<li key={line.id} className="relative flex min-w-0 gap-3">
							<span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-popover">
								<Icon
									icon={line.kind === "thought" ? AiBrain01Icon : toolIcon(line.name)}
									className={cn(
										"size-3.5",
										line.kind === "tool" && line.status === "error"
											? "text-destructive"
											: "text-muted-foreground",
									)}
								/>
							</span>
							<div className="min-w-0 flex-1">
								{line.kind === "thought" ? <Thought line={line} /> : <Block line={line} bare />}
							</div>
						</li>
					))}
				</ol>
			</Panel>
		</>
	);
}

/** The step's time, at the right edge so the times read as a column. */
function Took({ ms, live }: { ms: number | undefined; live: boolean }): ReactNode {
	if (ms === undefined) return null;
	return (
		<span
			className={cn(
				"ml-auto shrink-0 pl-2 text-[11.5px] tabular-nums",
				live ? "text-muted-foreground" : "text-dim",
			)}
		>
			{duration(ms)}
		</span>
	);
}

/** A thought: two lines of it, the last two while it thinks, and all of it a tap away. */
function Thought({ line }: { line: ThoughtLine }): ReactNode {
	const [open, setOpen] = useState(false);
	const now = useNow(1000, line.streaming && line.since !== undefined);
	const said = plain(line.text)
		.replace(/[*_`#]/g, "")
		.trim();
	const shown = line.streaming ? said.split("\n").filter(Boolean).slice(-2).join(" ") : said;
	let took = line.durationMs;
	if (line.streaming && line.since !== undefined) took = now - line.since;
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex min-w-0 items-center gap-2 text-left text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
			>
				<Icon icon={AiBrain01Icon} className={line.streaming ? "text-pi" : "text-dim"} />
				<span className={cn("shrink-0", line.streaming && "shimmer motion-reduce:shimmer-none")}>
					{line.streaming
						? "Thinking"
						: took === undefined
							? "Thought"
							: `Thought for ${duration(took)}`}
				</span>
				{line.streaming ? <Took ms={took} live /> : null}
			</button>
			{open ? (
				<div className="border-l-2 border-border pl-3 text-[13.5px] text-muted-foreground">
					<Markdown text={line.text} streaming={line.streaming} />
				</div>
			) : shown === "" ? null : (
				<p className="line-clamp-2 border-l-2 border-border pl-3 text-[13px] leading-snug text-dim">
					{shown}
				</p>
			)}
		</div>
	);
}

interface Shown {
	title: ReactNode;
	note?: string;
	body?: ReactNode;
	/** The few lines the block shows unopened: the end of the output, the start of a diff. */
	peek?: { lines: string[]; tone?: "diff" | "error" };
}

/** Tools that only look, drawn as a line without a block. */
const QUIET: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"web_search",
	"fetch_content",
]);

/** Tools whose subject is a command or a path, set in the code face. */
const CODE_TITLES: ReadonlySet<string> = new Set([
	"bash",
	"read",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
]);

const PEEK_LINES = 4;

/**
 * Writing is the model still typing the call: a dashed frame, a caret, no clock. Running is the
 * tool at work: a solid frame, a spinner and the time it has taken.
 */
function Block({ line, bare = false }: { line: ToolLine; bare?: boolean }): ReactNode {
	const [open, setOpen] = useState(false);
	const folder = useContext(SessionFolder);
	const writing = line.status === "writing";
	const running = line.status === "running";
	const now = useNow(1000, running && line.startedAt !== undefined);
	const shown = shownOf(line, folder);
	let took = writing ? undefined : line.durationMs;
	if (running && line.startedAt !== undefined) took = now - line.startedAt;
	const failed = line.status === "error";
	const quiet = QUIET.has(line.name) && !failed;
	const head = (
		<span className="flex min-w-0 items-center gap-2">
			<StatusIcon line={line} />
			<span
				className={cn(
					"min-w-0 truncate",
					CODE_TITLES.has(line.name) ? "font-mono text-[12.5px]" : "text-[13.5px]",
					(running || writing) && "text-foreground",
				)}
			>
				{shown.title}
			</span>
			{shown.note === undefined ? null : (
				<span className="shrink-0 font-mono text-[11.5px] text-dim">{shown.note}</span>
			)}
			{writing ? (
				<span className="ml-auto shrink-0 pl-2 text-[11.5px] text-pi">writing</span>
			) : (
				<Took ms={took} live={running} />
			)}
		</span>
	);
	const toggle = shown.body === undefined ? undefined : () => setOpen(!open);
	if (quiet || bare)
		return (
			<div className="flex min-w-0 flex-col gap-1.5">
				<button
					type="button"
					aria-expanded={toggle === undefined ? undefined : open}
					disabled={toggle === undefined}
					onClick={toggle}
					className="min-w-0 text-left text-muted-foreground transition-colors hover:text-foreground disabled:hover:text-muted-foreground"
				>
					{head}
				</button>
				{open ? shown.body : null}
			</div>
		);
	// A call being written shows its caret even before its first character.
	const peeked = writing && shown.peek?.lines.length === 0 ? [""] : (shown.peek?.lines ?? []);
	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border bg-raised transition-colors",
				writing && "border-dashed border-pi/50",
				running && "border-pi/40",
				failed && "border-destructive/40",
			)}
		>
			<button
				type="button"
				aria-expanded={toggle === undefined ? undefined : open}
				disabled={toggle === undefined}
				onClick={toggle}
				className="block w-full min-w-0 px-3 py-2 text-left text-muted-foreground"
			>
				{head}
			</button>
			{open ? (
				<div className="border-t px-2 pt-2 pb-2">{shown.body}</div>
			) : peeked.length === 0 ? null : (
				<pre
					className={cn(
						"border-t px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-muted-foreground",
						// Written text wraps, and its newest line with the caret stays in view.
						writing && "flex max-h-28 flex-col justify-end overflow-hidden",
					)}
				>
					{peeked.map((text, at) => (
						<span
							key={at}
							className={cn("block", !writing && "truncate", peekTone(text, shown.peek?.tone))}
						>
							{text === "" && !writing ? " " : text}
							{writing && at === peeked.length - 1 ? <Caret /> : null}
						</span>
					))}
				</pre>
			)}
		</div>
	);
}

function peekTone(text: string, tone: "diff" | "error" | undefined): string | undefined {
	if (tone === "error") return "text-destructive/90";
	if (tone !== "diff") return undefined;
	if (text.startsWith("+")) return "text-ok";
	if (text.startsWith("-")) return "text-destructive/90";
	return undefined;
}

/** Where the model is typing. */
function Caret(): ReactNode {
	return (
		<span
			aria-hidden="true"
			className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[0.15em] animate-[caret_1s_steps(1)_infinite] bg-pi/80 motion-reduce:animate-none"
		/>
	);
}

function StatusIcon({ line }: { line: ToolLine }): ReactNode {
	switch (line.status) {
		case "writing":
			return <Icon icon={toolIcon(line.name)} className="text-pi" />;
		case "running":
			return (
				<Icon icon={Loading03Icon} className="animate-spin text-pi motion-reduce:animate-none" />
			);
		case "error":
			return <Icon icon={toolIcon(line.name)} className="text-destructive" />;
		case "pending":
			return <Icon icon={toolIcon(line.name)} className="text-dim" />;
		default:
			return <Icon icon={toolIcon(line.name)} className="text-dim" />;
	}
}

/** An edit's first changed lines, from pi's patch or, while it is written, from its arguments. */
function changedLines(patch: string | undefined, edits: unknown): string[] {
	if (patch !== undefined)
		return patch
			.split("\n")
			.filter((one) => /^[+-]/.test(one) && !/^(\+\+\+|---)/.test(one))
			.slice(0, PEEK_LINES);
	const list = Array.isArray(edits) ? edits : [];
	return list
		.flatMap((one: unknown) => {
			const { oldText, newText } = (one ?? {}) as { oldText?: unknown; newText?: unknown };
			return [
				...(typeof oldText === "string" ? oldText.split("\n").map((text) => `-${text}`) : []),
				...(typeof newText === "string" ? newText.split("\n").map((text) => `+${text}`) : []),
			];
		})
		.slice(0, PEEK_LINES);
}

/** The last lines a reader would look at: what a command printed last. */
function tail(text: string | undefined): string[] {
	if (text === undefined) return [];
	const lines = plain(text).replace(/\s+$/, "").split("\n");
	return lines.slice(-PEEK_LINES);
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function output(line: ToolLine, language = "ansi"): ReactNode {
	const said = line.output ?? "";
	if (said.trim() === "") return undefined;
	return (
		<Code
			code={line.truncated === true ? `…\n${said}` : said}
			language={language}
			size="sm"
			maxHeight="max-h-72"
			className={line.status === "error" ? "border-destructive/40" : undefined}
		/>
	);
}

function shownOf(line: ToolLine, folder?: string): Shown {
	const args = line.args;
	const full = text(args.path) || text(args.file_path);
	const path = inside(full, folder);
	switch (line.name) {
		case "bash": {
			const command = text(args.command);
			const multiline = command.trim().includes("\n");
			return {
				title: commandTitle(command) || "bash",
				// While it is written, the command as it comes; once it runs, what it prints last.
				peek:
					line.status === "writing"
						? { lines: command.split("\n").slice(-PEEK_LINES) }
						: { lines: tail(line.output), ...(line.status === "error" ? { tone: "error" } : {}) },
				body: (
					<div className="flex flex-col gap-2">
						{multiline ? (
							<Code code={command} language="bash" size="sm" maxHeight="max-h-48" />
						) : null}
						{output(line)}
					</div>
				),
			};
		}
		case "read": {
			const from = typeof args.offset === "number" ? args.offset : undefined;
			const count = typeof args.limit === "number" ? args.limit : undefined;
			const range =
				from === undefined
					? undefined
					: `lines ${from}–${count === undefined ? "" : from + count - 1}`;
			return {
				title: path || "read",
				...(range === undefined ? {} : { note: range }),
				...(line.output === undefined ? {} : { body: output(line, languageOfPath(path)) }),
			};
		}
		case "edit": {
			const patch = patchOf(line.details);
			return {
				title: path || "edit",
				...(patch === undefined ? {} : { note: changesOf(patch) }),
				peek: { lines: changedLines(patch, args.edits), tone: "diff" },
				body:
					patch === undefined ? (
						<EditsPreview edits={args.edits} path={path} following={line.status === "writing"} />
					) : (
						<Suspense fallback={<Code code={patch} language="diff" size="sm" />}>
							<Diff patch={patch} />
						</Suspense>
					),
			};
		}
		case "write": {
			const content = text(args.content);
			const lines = content === "" ? 0 : content.split("\n").length;
			const written = content.split("\n");
			return {
				title: path || "write",
				note: `${lines} line${lines === 1 ? "" : "s"}`,
				// While it is written, its newest lines; once written, its first.
				peek: {
					lines:
						line.status === "writing" ? written.slice(-PEEK_LINES) : written.slice(0, PEEK_LINES),
				},
				body: (
					<Code
						code={content}
						language={languageOfPath(path)}
						size="sm"
						maxHeight="max-h-72"
						follow={line.status === "writing"}
						numbered
					/>
				),
			};
		}
		case "grep":
		case "find":
			return {
				title: [text(args.pattern), path].filter(Boolean).join("  in ") || line.name,
				...(line.output === undefined ? {} : { body: output(line, "text") }),
			};
		case "ls":
			return {
				title: path || ".",
				...(line.output === undefined ? {} : { body: output(line, "text") }),
			};
		case "codemode":
			return {
				title: "codemode",
				peek: { lines: tail(line.output) },
				body: (
					<div className="flex flex-col gap-2">
						<Code code={text(args.code)} language="javascript" size="sm" maxHeight="max-h-60" />
						{output(line, "text")}
					</div>
				),
			};
		case "ask_questions":
			return {
				title: askedOf(args),
				...(line.output === undefined ? {} : { body: <Markdown text={line.output} /> }),
			};
		case "web_search":
		case "fetch_content":
		case "source_check":
			return {
				title: text(args.query) || text(args.url) || text(args.claim) || line.name,
				...(line.output === undefined ? {} : { body: output(line, "text") }),
			};
		case "peers":
			return {
				title: ["peers", text(args.action), text(args.to)].filter(Boolean).join(" "),
				body: text(args.text) === "" ? output(line, "text") : <Markdown text={text(args.text)} />,
			};
		case "board":
			return {
				title: ["board", text(args.op), text(args.title) || text(args.id)]
					.filter(Boolean)
					.join(" "),
				...(line.output === undefined ? {} : { body: output(line, "text") }),
			};
		default:
			return {
				title: [line.name, subjectOf(args)].filter(Boolean).join(" "),
				body: (
					<div className="flex flex-col gap-2">
						{Object.keys(args).length === 0 ? null : (
							<Code
								code={JSON.stringify(args, null, 2)}
								language="json"
								size="sm"
								maxHeight="max-h-48"
							/>
						)}
						{output(line, "text")}
					</div>
				),
			};
	}
}

/** The edit as it is written, before pi has made the patch: each old text over its new one. */
function EditsPreview({
	edits,
	path,
	following,
}: {
	edits: unknown;
	path: string;
	following: boolean;
}): ReactNode {
	const list = Array.isArray(edits) ? edits : [];
	const lines = list.flatMap((edit: unknown, index) => {
		const { oldText, newText } = (edit ?? {}) as { oldText?: unknown; newText?: unknown };
		const removed = typeof oldText === "string" ? oldText.split("\n").map((one) => `-${one}`) : [];
		const added = typeof newText === "string" ? newText.split("\n").map((one) => `+${one}`) : [];
		return [...(index === 0 ? [] : ["@@"]), ...removed, ...added];
	});
	if (lines.length === 0)
		return <p className="text-xs text-muted-foreground">Writing the edit to {path}…</p>;
	return (
		<Code
			code={lines.join("\n")}
			language="diff"
			size="sm"
			maxHeight="max-h-72"
			follow={following}
		/>
	);
}

function subjectOf(args: Record<string, unknown>): string {
	for (const key of ["command", "path", "pattern", "query", "url", "action", "name"]) {
		const value = text(args[key]);
		if (value !== "") return firstLine(value);
	}
	return "";
}

function askedOf(args: Record<string, unknown>): string {
	const questions = Array.isArray(args.questions) ? args.questions.length : 0;
	return questions === 0
		? "Asked you"
		: `Asked you ${questions} question${questions === 1 ? "" : "s"}`;
}

function patchOf(details: unknown): string | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const patch = (details as { patch?: unknown }).patch;
	return typeof patch === "string" && patch.trim() !== "" ? patch : undefined;
}
