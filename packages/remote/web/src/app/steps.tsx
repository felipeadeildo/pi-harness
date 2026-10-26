// A run of the agent's steps: each thought and each tool call is one line that opens on what it did.
import type { Live } from "@adeildo/pi-remote-protocol/client";
import { AiBrain01Icon, AlertCircleIcon, WorkflowSquare03Icon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { createContext, lazy, type ReactNode, Suspense, useContext, useState } from "react";

import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace";
import { duration } from "@/session/format.ts";
import { plain } from "@/session/plain.ts";
import {
	changesOf,
	commandTitle,
	countsOf,
	firstLine,
	isRunning,
	spanOf,
} from "@/session/steps.ts";
import { type StepLine, type ThoughtLine, type ToolLine, withRunning } from "@/session/turns.ts";

import { Code, languageOfPath } from "./code.tsx";
import { Icon, useNow } from "./kit.tsx";
import { Markdown } from "./markdown.tsx";
import { toolIcon } from "./tool-icons.ts";

const Diff = lazy(() => import("./diff.tsx"));

/** The tools still running, so a line pi wrote follows its call without the transcript redrawing. */
export const RunningTools = createContext<Live["tools"]>({});

/** A longer run reads as one line, "Worked for 1m 12s", that opens on its steps. */
const GROUP_FROM = 4;

/**
 * A run of steps. Nothing opens or closes by itself, so the page never jumps: a running step says
 * what it does on its own line, and the reader opens what they want to read.
 */
export function Steps({
	lines,
	trailing,
}: {
	lines: readonly StepLine[];
	trailing: boolean;
}): ReactNode {
	const tools = useContext(RunningTools);
	const shown = lines.map((line) => (line.kind === "tool" ? withRunning(line, tools) : line));
	const list = (
		<Trace className="gap-1">
			{shown.map((line) =>
				line.kind === "thought" ? (
					<Thought key={line.id} line={line} />
				) : (
					<Tool key={line.id} line={line} />
				),
			)}
		</Trace>
	);
	if (shown.length < GROUP_FROM) return list;
	return (
		<Run lines={shown} trailing={trailing}>
			{list}
		</Run>
	);
}

function Run({
	lines,
	trailing,
	children,
}: {
	lines: readonly StepLine[];
	trailing: boolean;
	children: ReactNode;
}): ReactNode {
	// Open when it is what the agent is doing as the page opens, and it stays as the reader leaves it.
	const [open, setOpen] = useState(trailing);
	const running = lines.some(isRunning);
	const now = useNow(1000, running);
	const span = spanOf(lines, running ? now : undefined);
	const failed = lines.some((line) => line.kind === "tool" && line.status === "error");
	let title = running ? "Working" : "Worked";
	if (span !== undefined) title += ` for ${duration(span)}`;
	return (
		<Trace>
			<TraceCollapsible open={open} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger className="!w-full">
					<TraceLine className="w-full" {...(running ? { status: "running" as const } : {})}>
						<TraceIcon>
							<Icon
								icon={failed ? AlertCircleIcon : WorkflowSquare03Icon}
								className={failed ? "text-destructive" : undefined}
							/>
						</TraceIcon>
						<TraceTitle className="flex-none">{title}</TraceTitle>
						<TraceDescription className="min-w-0 flex-1 truncate">
							{countsOf(lines)}
						</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent keepMounted className="pt-1.5 pl-1">
					{children}
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/** The step's time, to the right of every line so the times read as a column. */
function Took({ ms }: { ms: number | undefined }): ReactNode {
	if (ms === undefined) return null;
	return (
		<span className="ml-auto shrink-0 pl-2 text-[11.5px] text-dim tabular-nums">
			{duration(ms)}
		</span>
	);
}

function Thought({ line }: { line: ThoughtLine }): ReactNode {
	const now = useNow(1000, line.streaming && line.since !== undefined);
	const said = plain(line.text).trim();
	// While it thinks, the line shows its latest sentence; once done, its first.
	const preview = (line.streaming ? said.split("\n").at(-1) : said.split("\n")[0]) ?? "";
	let took = line.durationMs;
	if (line.streaming && line.since !== undefined) took = now - line.since;
	return (
		<Folding
			head={
				<TraceLine className="w-full" {...(line.streaming ? { status: "running" as const } : {})}>
					<TraceIcon>
						<Icon icon={AiBrain01Icon} />
					</TraceIcon>
					<TraceTitle className="flex-none">{line.streaming ? "Thinking" : "Thought"}</TraceTitle>
					<TraceDescription className="min-w-0 flex-1 truncate">
						{preview.replace(/[*_`#]/g, "")}
					</TraceDescription>
					<Took ms={took} />
				</TraceLine>
			}
			body={<Markdown text={line.text} />}
			className="text-[13.5px]"
		/>
	);
}

interface Shown {
	title: ReactNode;
	note?: string;
	body?: ReactNode;
}

function Tool({ line }: { line: ToolLine }): ReactNode {
	const running = line.status === "running" || line.status === "writing";
	const now = useNow(1000, running && line.startedAt !== undefined);
	const shown = shownOf(line);
	let took = line.durationMs;
	if (running && line.startedAt !== undefined) took = now - line.startedAt;
	const status = TRACE_STATUS[line.status];
	const head = (
		<TraceLine {...(status === undefined ? {} : { status })} className="w-full">
			<TraceIcon>
				<Icon icon={toolIcon(line.name)} />
			</TraceIcon>
			<TraceTitle
				className={cn(
					"min-w-0 flex-[0_1_auto]",
					CODE_TITLES.has(line.name) && "font-mono text-[12.5px]",
				)}
			>
				{shown.title}
			</TraceTitle>
			<TraceDescription className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
				{noteOf(line, shown)}
			</TraceDescription>
			<Took ms={took} />
		</TraceLine>
	);
	if (shown.body === undefined) return head;
	return <Folding head={head} body={shown.body} className="pr-0 text-foreground" />;
}

/** What a step says beside its name: what it found, or while it runs, how far it got. */
function noteOf(line: ToolLine, shown: Shown): string | undefined {
	if (line.status === "running" && line.name === "bash") {
		const last = plain(line.output ?? "")
			.trimEnd()
			.split("\n")
			.at(-1)
			?.trim();
		if (last !== undefined && last !== "") return last;
	}
	return shown.note;
}

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

const TRACE_STATUS: Record<ToolLine["status"], "running" | "error" | "pending" | undefined> = {
	writing: "running",
	running: "running",
	pending: "pending",
	error: "error",
	done: undefined,
};

/** Closed until the reader opens it. */
function Folding({
	head,
	body,
	className,
}: {
	head: ReactNode;
	body: ReactNode;
	className?: string;
}): ReactNode {
	return (
		<TraceCollapsible>
			<TraceCollapsibleTrigger className="!w-full">{head}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className={className}>{body}</TraceCollapsibleContent>
		</TraceCollapsible>
	);
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

function shownOf(line: ToolLine): Shown {
	const args = line.args;
	const path = text(args.path) || text(args.file_path);
	switch (line.name) {
		case "bash": {
			const command = text(args.command);
			const multiline = command.trim().includes("\n");
			return {
				title: commandTitle(command) || "bash",
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
			return {
				title: path || "write",
				note: `${lines} line${lines === 1 ? "" : "s"}`,
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
