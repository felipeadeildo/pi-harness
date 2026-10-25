// One session, read only: its transcript, its tasks and the question it waits on. Everything here is
// text from elsewhere, so it goes through the W2 renderer and never through raw HTML. Like that
// renderer, it builds DOM nodes with `createElement`, which the native app hosts as a DOM component.
//
// A model's thinking folds into one line, a `<details>` the reader opens, so a long chain of thought
// does not push the answer off the screen. A tool's output shows its first lines and folds the rest.
import { type ClientSession, harnessOf, transcriptOfSession } from "@adeildo/pi-remote-client";
import {
	type ChatMessage,
	type OpenAsk,
	openQuestions,
	type SessionState,
	type SessionTasks,
	type Task,
	type TranscriptItem,
} from "@adeildo/pi-remote-protocol";
import { type ReactNode, createElement as h } from "react";

import { Markdown, plain } from "../../render/index.ts";

/** How many lines of a tool's output show before the rest folds. */
export const OUTPUT_LINES = 8;
/** How wide a shown line of a tool's output gets before it is cut. */
export const LINE_CHARS = 160;
/** How much of the first line of a thought names the fold. */
const THOUGHT_CHARS = 80;

/** The tasks the screen lists: what is going on and what waits, never what is done or dropped. */
const OPEN: ReadonlySet<Task["status"]> = new Set(["doing", "waiting", "queued"]);

export interface SessionScreenProps {
	session: ClientSession;
}

export function SessionScreen({ session }: SessionScreenProps): ReactNode {
	const { state, items } = viewOf(session);
	return h(
		"main",
		{ className: "remote-session" },
		header(session, state.tasks),
		h("ol", { className: "remote-transcript" }, ...items.flatMap((item) => itemNodes(item))),
		tasksNode(state.tasks),
		...openQuestions(state).map(askNode),
	);
}

interface View {
	state: SessionState;
	items: TranscriptItem[];
}

const views = new WeakMap<ClientSession, { key: readonly unknown[]; view: View }>();

/**
 * The transcript and the state, worked out again only when what they come from changed. A client
 * changes its session in place: an entry or a state change is pushed onto its list, a snapshot swaps the
 * list, and a `/tree` move changes the leaf. So the lists, their lengths and the leaf say whether
 * anything moved, and a screen that draws on every envelope does not fold the whole log each time.
 * An entry changed where it stands would go unseen: the client never does that today, and one that
 * starts to has to swap the list or bump what this compares.
 */
export function viewOf(session: ClientSession): View {
	const key = [
		session.entries,
		session.entries.length,
		session.leaf,
		session.state,
		Object.keys(session.state.questions).length +
			Object.keys(session.state.permissions.rulings).length,
	];
	const held = views.get(session);
	if (held !== undefined && held.key.every((part, at) => part === key[at])) return held.view;
	const view = { state: harnessOf(session), items: transcriptOfSession(session).items };
	views.set(session, { key, view });
	return view;
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

/**
 * What the header says about the session beside its name: the machine, what it is doing and the model it
 * answers with. It is text, and typed as text on purpose — this array goes to a `join`, and an
 * `unknown[]` let the folded state object through to become `[object Object]` without a word from the
 * compiler. The status is the field for "what it is doing"; the folded `state` is the whole picture.
 */
export function aboutOf(session: ClientSession): string[] {
	const { state } = session;
	return [session.key.machine, state.status, state.model?.id].filter(
		(part): part is string => part !== undefined,
	);
}

function header(session: ClientSession, tasks: SessionTasks | undefined): ReactNode {
	const about = aboutOf(session);
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
		case "custom":
			// What an extension put in the chat, like a colleague's message: the terminal shows it, so
			// does the screen, or the agent's answer would reply to nothing.
			return item.display === true
				? [line(item.entry, item.customType, textOf(partsOf(item.data)))]
				: [];
		default:
			// Labels, usage, extensions' state and what a newer pi writes are not the conversation.
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
	// A redacted thought carries no text, so its fold is named by the word alone.
	const summary = named === "" ? "thinking" : `thinking · ${named}`;
	return h(
		"li",
		{ key, className: "remote-thinking" },
		h("details", undefined, h("summary", undefined, summary), h("pre", undefined, plain(text))),
	);
}

/**
 * A tool's output: its first lines, each cut at a width, and the whole of it in a fold under them
 * when anything was left out. A single line can be a whole JSON dump, so lines are cut as well.
 */
function output(text: string): ReactNode {
	const lines = plain(text).split("\n");
	// Nearly every output ends with a newline, which is no line of its own.
	if (lines.length > 1 && lines.at(-1) === "") lines.pop();
	const first = lines.slice(0, OUTPUT_LINES);
	const cut = first.map((one) =>
		one.length > LINE_CHARS ? `${one.slice(0, LINE_CHARS - 1)}…` : one,
	);
	const shown = h("pre", undefined, cut.join("\n"));
	const rest = lines.length - first.length;
	const wide = cut.some((one, at) => one !== first[at]);
	if (rest === 0 && !wide) return shown;
	const more = rest === 0 ? "the whole output" : `${rest} more line${rest === 1 ? "" : "s"}`;
	// The fold holds everything when a line was cut, and only the rest when none was.
	const folded = wide ? lines : lines.slice(OUTPUT_LINES);
	return h(
		"div",
		undefined,
		shown,
		h("details", undefined, h("summary", undefined, more), h("pre", undefined, folded.join("\n"))),
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
