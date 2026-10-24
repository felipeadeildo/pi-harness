// One session, read only: its transcript, its tasks and the question it waits on. Everything here is
// text from elsewhere, so it goes through the W2 renderer and never through raw HTML. Like that
// renderer, it builds DOM nodes with `createElement`, which the native app hosts as a DOM component.
//
// A model's thinking folds into one line, a `<details>` the reader opens, so a long chain of thought
// does not push the answer off the screen. A tool's output shows its first lines and folds the rest.
import { type ClientSession, factsOf, transcriptOfSession } from "@adeildo/pi-remote-client";
import {
	type ChatMessage,
	type OpenAsk,
	openAsks,
	type SessionTasks,
	type Task,
	type TranscriptItem,
} from "@adeildo/pi-remote-protocol";
import { type ReactNode, createElement as h } from "react";

import { Markdown, plain } from "../../render/index.ts";

/** How many lines of a tool's output show before the rest folds. */
export const OUTPUT_LINES = 8;
/** How much of the first line of a thought names the fold. */
const THOUGHT_CHARS = 80;

/** The tasks the screen lists: what is going on and what waits, never what is done or dropped. */
const OPEN: ReadonlySet<Task["status"]> = new Set(["doing", "waiting", "queued"]);

export interface SessionScreenProps {
	session: ClientSession;
}

export function SessionScreen({ session }: SessionScreenProps): ReactNode {
	const facts = factsOf(session);
	const items = transcriptOfSession(session).items;
	return h(
		"main",
		{ className: "remote-session" },
		header(session, facts.tasks),
		h("ol", { className: "remote-transcript" }, ...items.flatMap((item) => itemNodes(item))),
		tasksNode(facts.tasks),
		...openAsks(facts).map(askNode),
		h("p", { className: "remote-read-only" }, "Read only."),
	);
}

/** What the session is called: the title pi or the tasks gave it, else the handle a room uses. */
export function titleOf(session: ClientSession, tasks?: SessionTasks): string {
	const snapshot = session.snapshot;
	return (
		snapshot?.name ??
		tasks?.title ??
		snapshot?.handle ??
		tasks?.handle ??
		`new-${session.key.session.slice(-4)}`
	);
}

function header(session: ClientSession, tasks: SessionTasks | undefined): ReactNode {
	const snapshot = session.snapshot;
	const about = [
		session.key.machine,
		snapshot?.state,
		snapshot?.model === undefined ? undefined : snapshot.model.id,
	].filter((part) => part !== undefined);
	return h(
		"header",
		undefined,
		h("h1", undefined, plain(titleOf(session, tasks))),
		h("p", { className: "remote-about" }, plain(about.join(" · "))),
	);
}

function itemNodes(item: TranscriptItem): ReactNode[] {
	switch (item.kind) {
		case "message":
			return messageNodes(item.entry, item.message);
		case "compaction":
			return [line(item.entry, "compacted", item.summary)];
		case "branch":
			return [line(item.entry, "branch summary", item.summary)];
		case "model":
			return [line(item.entry, "model", `${item.provider}/${item.model}`)];
		default:
			// Labels, usage, notes of extensions and what a newer pi writes are not the conversation.
			return [];
	}
}

/** A message, one node per part: what you wrote, what the model thought, said and called. */
function messageNodes(entry: string, message: ChatMessage): ReactNode[] {
	const parts = partsOf(message.content);
	switch (message.role) {
		case "user":
			return [block(entry, "you", h(Markdown, { text: textOf(parts) }))];
		case "assistant": {
			const nodes = parts.map((part, at) => assistantPart(`${entry}:${at}`, part));
			if (message.errorMessage !== undefined)
				nodes.push(line(`${entry}:error`, "error", message.errorMessage));
			return nodes.filter((node) => node !== undefined);
		}
		case "toolResult":
			return [block(entry, "output", output(textOf(parts)))];
		default:
			return [];
	}
}

type Part = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };

function partsOf(content: unknown): Part[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content.filter(
		(part): part is Part =>
			typeof part === "object" && part !== null && typeof part.type === "string",
	);
}

function textOf(parts: readonly Part[]): string {
	return parts
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

function assistantPart(key: string, part: Part): ReactNode {
	switch (part.type) {
		case "text":
			return block(key, "pi", h(Markdown, { text: part.text ?? "" }));
		case "thinking":
			return thought(key, part.thinking ?? "");
		case "toolCall":
			return line(key, part.name ?? "tool", argsOf(part.arguments));
		default:
			return undefined;
	}
}

/** A thought, folded into its first line. */
function thought(key: string, text: string): ReactNode {
	const first = plain(text).trim().split("\n")[0] ?? "";
	const named = first.length > THOUGHT_CHARS ? `${first.slice(0, THOUGHT_CHARS - 1)}…` : first;
	return h(
		"li",
		{ key, className: "remote-thinking" },
		h(
			"details",
			undefined,
			h("summary", undefined, `thinking · ${named}`),
			h("pre", undefined, plain(text)),
		),
	);
}

/** A tool's output: its first lines, and the rest folded under how many there are. */
function output(text: string): ReactNode {
	const lines = plain(text).split("\n");
	const shown = h("pre", undefined, lines.slice(0, OUTPUT_LINES).join("\n"));
	if (lines.length <= OUTPUT_LINES) return shown;
	const rest = lines.length - OUTPUT_LINES;
	return h(
		"details",
		undefined,
		h("summary", undefined, shown, `${rest} more line${rest === 1 ? "" : "s"}`),
		h("pre", undefined, lines.slice(OUTPUT_LINES).join("\n")),
	);
}

/** The arguments of a call on one line, the way the terminal shows them folded. */
function argsOf(args: unknown): string {
	if (typeof args !== "object" || args === null) return "";
	return Object.entries(args)
		.map(([name, value]) => `${name}=${typeof value === "string" ? value : JSON.stringify(value)}`)
		.join(" ");
}

function block(key: string, who: string, body: ReactNode): ReactNode {
	return h(
		"li",
		{ key, className: `remote-${who}` },
		h("span", { className: "remote-who" }, who),
		body,
	);
}

function line(key: string, label: string, text: string): ReactNode {
	return h(
		"li",
		{ key, className: "remote-line" },
		h("span", { className: "remote-who" }, label),
		` ${plain(text)}`,
	);
}

function tasksNode(tasks: SessionTasks | undefined): ReactNode {
	const open = (tasks?.tasks ?? []).filter((task) => OPEN.has(task.status));
	if (open.length === 0) return undefined;
	return h(
		"section",
		{ className: "remote-tasks" },
		h("h2", undefined, "Tasks"),
		h(
			"ul",
			undefined,
			...open.map((task) =>
				h(
					"li",
					{ key: task.id, className: `remote-task-${task.status}` },
					`${task.status} · ${plain(task.text)}`,
				),
			),
		),
	);
}

/** A question the session waits on. It is answered from the terminal or a later version of this app. */
function askNode(ask: OpenAsk): ReactNode {
	return h(
		"section",
		{ key: ask.id, className: "remote-ask" },
		h("h2", undefined, "Waiting for an answer"),
		...ask.questions.map((question, at) =>
			h(
				"div",
				{ key: `${ask.id}:${at}` },
				h(
					"p",
					undefined,
					h("strong", undefined, plain(question.header)),
					` ${plain(question.question)}`,
				),
				h(
					"ul",
					undefined,
					...question.options.map((option, index) =>
						h("li", { key: `${at}:${index}` }, plain(option.label)),
					),
				),
			),
		),
	);
}
