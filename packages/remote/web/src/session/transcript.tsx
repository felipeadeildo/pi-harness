// The transcript. Text from elsewhere goes through the markdown renderer, never raw HTML.
import {
	type ChatMessage,
	type SessionState,
	type TranscriptItem,
} from "@adeildo/pi-remote-protocol";
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";
import { createContext, type CSSProperties, type ReactNode, useContext } from "react";

import { Markdown } from "../ui/markdown.tsx";
import { type Scheme, piColor } from "../ui/pi-colors.ts";
import { plain } from "./plain.ts";
import { originOf, viewOf } from "./session-view.ts";

/** How many lines of a tool's output show before the rest folds. */
const OUTPUT_LINES = 8;
/** How wide a shown line of a tool's output gets before it is cut. */
const LINE_CHARS = 160;
/** How much of the first line of a thought names the fold. */
const THOUGHT_CHARS = 80;

/** The colors the session wears when it has said which: the person's accent, and the agent's own. */
interface Worn {
	accent?: string;
	agent?: string;
}

const WornContext = createContext<Worn>({});

export function Transcript({
	session,
	scheme,
}: {
	session: ClientSession;
	scheme: Scheme;
}): ReactNode {
	const { state, items } = viewOf(session);
	const worn: Worn = {
		accent: piColor(scheme, state.theme?.accent),
		agent: piColor(scheme, state.theme?.color),
	};
	return (
		<WornContext.Provider value={worn}>
			{/* A transcript is a sequence of messages, not a numbered procedure: the index says nothing. */}
			<ol className="remote-transcript">
				{items.flatMap((item) => itemNodes(item, state.promptFrom))}
			</ol>
		</WornContext.Provider>
	);
}

function itemNodes(item: TranscriptItem, promptFrom: SessionState["promptFrom"]): ReactNode[] {
	switch (item.kind) {
		case "message":
			return messageNodes(item.entry, item.message, promptFrom);
		case "compaction":
			return [line(item.entry, "compacted", item.summary)];
		case "branch":
			return [line(item.entry, "branch summary", item.summary)];
		case "model":
			return [line(item.entry, "model", `${item.provider}/${item.model}`)];
		case "custom":
			// What an extension put in the chat, like a colleague's message: the terminal shows it, so
			// does the page, or the agent's answer would reply to nothing.
			return item.display === true
				? [line(item.entry, item.customType, textOf(partsOf(item.data)))]
				: [];
		default:
			// Labels, usage, extensions' state and what a newer pi writes are not the conversation.
			return [];
	}
}

/** A message, one node per part: what you wrote, what the model thought, said and called. */
function messageNodes(
	entry: string,
	message: ChatMessage,
	promptFrom: SessionState["promptFrom"],
): ReactNode[] {
	const parts = partsOf(message.content);
	switch (message.role) {
		case "user":
			return [
				<Block key={entry} who="you" origin={originOf(promptFrom, entry)}>
					<Markdown text={textOf(parts)} />
				</Block>,
			];
		case "assistant": {
			const nodes = parts.map((part, at) => assistantPart(`${entry}:${at}`, part));
			if (message.errorMessage !== undefined)
				nodes.push(line(`${entry}:error`, "error", message.errorMessage));
			return nodes.filter((node) => node !== undefined);
		}
		case "toolResult":
			return [
				<Block key={entry} who="output" origin={undefined}>
					{output(textOf(parts))}
				</Block>,
			];
		default:
			return [];
	}
}

interface Part {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	arguments?: unknown;
}

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
			return (
				<Block key={key} who="pi" origin={undefined}>
					<Markdown text={part.text ?? ""} />
				</Block>
			);
		case "thinking":
			return thought(key, part.thinking ?? "");
		case "toolCall":
			// A question is drawn by the panel above the composer, where it can be answered: showing its
			// call here would draw the same question twice, and the raw arguments are not the question.
			return isQuestion(part.name)
				? undefined
				: line(key, part.name ?? "tool", argsOf(part.arguments));
		default:
			return undefined;
	}
}

/** The two tools a session asks a person with, which the panel draws instead of the transcript. */
function isQuestion(name: string | undefined): boolean {
	return name === "ask_questions" || name === "ask_permission";
}

/** A thought, folded into its first line. */
function thought(key: string, text: string): ReactNode {
	const first = plain(text).trim().split("\n")[0] ?? "";
	const named = first.length > THOUGHT_CHARS ? `${first.slice(0, THOUGHT_CHARS - 1)}…` : first;
	// A redacted thought carries no text, so its fold is named by the word alone.
	const summary = named === "" ? "thinking" : `thinking · ${named}`;
	return (
		<li key={key} className="remote-thinking">
			<details>
				<summary>{summary}</summary>
				<pre>{plain(text)}</pre>
			</details>
		</li>
	);
}

/** The first lines, each cut, with the rest in a fold. */
function output(text: string): ReactNode {
	const lines = plain(text).split("\n");
	// Nearly every output ends with a newline, which is no line of its own.
	if (lines.length > 1 && lines.at(-1) === "") lines.pop();
	const first = lines.slice(0, OUTPUT_LINES);
	const cut = first.map((one) =>
		one.length > LINE_CHARS ? `${one.slice(0, LINE_CHARS - 1)}…` : one,
	);
	const rest = lines.length - first.length;
	const wide = cut.some((one, at) => one !== first[at]);
	const shown = <pre>{cut.join("\n")}</pre>;
	if (rest === 0 && !wide) return shown;
	const more = rest === 0 ? "the whole output" : `${rest} more line${rest === 1 ? "" : "s"}`;
	// The fold holds everything when a line was cut, and only the rest when none was.
	const folded = wide ? lines : lines.slice(OUTPUT_LINES);
	return (
		<div>
			{shown}
			<details>
				<summary>{more}</summary>
				<pre>{folded.join("\n")}</pre>
			</details>
		</div>
	);
}

/** The arguments of a call on one line, the way the terminal shows them folded. */
function argsOf(args: unknown): string {
	if (typeof args !== "object" || args === null) return "";
	return Object.entries(args)
		.map(([name, value]) => `${name}=${typeof value === "string" ? value : JSON.stringify(value)}`)
		.join(" ");
}

function Block({
	who,
	origin,
	children,
}: {
	who: string;
	origin: string | undefined;
	children: ReactNode;
}): ReactNode {
	const { accent, agent } = useContext(WornContext);
	const color = who === "you" ? accent : who === "pi" ? agent : undefined;
	const style: CSSProperties | undefined = color === undefined ? undefined : { color };
	return (
		<li className={`remote-${who}`}>
			<span className="remote-who" style={style}>
				{who === "you" ? "\u276F you" : who}
			</span>
			{origin === undefined ? null : <span className="remote-from">{origin}</span>}
			{children}
		</li>
	);
}

function line(key: string, label: string, text: string): ReactNode {
	return (
		<li key={key} className="remote-line">
			<span className="remote-who">{label}</span> {plain(text)}
		</li>
	);
}
