"use dom";

// One default export, nothing else: the native bundler refuses a DOM component module that exports more
// than that, and no web test sees it. A second `export` here breaks Android and green stays green.

import {
	type ChatMessage,
	type SessionState,
	type TranscriptItem,
} from "@adeildo/pi-remote-protocol";
// The document half of a session: the transcript and the question it waits on. Everything
// here is text from elsewhere, so it goes through the W2 renderer and never through raw HTML. It is a
// DOM component because a phone has no `main`, `ol` or `details`, and text is what this draws.
//
// A model's thinking folds into one line, a `<details>` the reader opens, so a long chain of thought
// does not push the answer off the screen. A tool's output shows its first lines and folds the rest.
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";
import { type ReactNode, createContext, createElement as h, useContext } from "react";

import { Markdown, plain } from "../../render/index.ts";
import { piColor } from "../../ui/pi-colors.ts";
import { type Scheme, type Theme, themeFor } from "../../ui/theme.ts";
import { aboutOf, originOf, titleOf, viewOf } from "./session-view.ts";

/** How many lines of a tool's output show before the rest folds. */
const OUTPUT_LINES = 8;
/** How wide a shown line of a tool's output gets before it is cut. */
const LINE_CHARS = 160;
/** How much of the first line of a thought names the fold. */
const THOUGHT_CHARS = 80;

interface SessionScreenProps {
	session: ClientSession;
	/** What the DOM host needs on a phone, where the document has no page to size itself by. */
	dom?: { matchContents?: boolean };
	/**
	 * The system's scheme, which the host reads and this document, a web view with no React Native
	 * around it, cannot. Without it the document is light.
	 */
	scheme?: Scheme;
}

/** What a block draws with: the theme, and the colors the session wears when it has said which. */
interface Worn {
	theme: Theme;
	/** The accent of the theme the session runs under, for what the person said. */
	accent?: string;
	/** The color the room gave the session, for what the agent said. */
	agent?: string;
}

const WornContext = createContext<Worn>({ theme: themeFor("light") });

export default function SessionDocument({ session, scheme }: SessionScreenProps): ReactNode {
	const { state, items } = viewOf(session);
	const theme = themeFor(scheme ?? "light");
	const worn: Worn = {
		theme,
		accent: piColor(scheme ?? "light", state.theme?.accent),
		agent: piColor(scheme ?? "light", state.theme?.color),
	};
	return h(
		WornContext.Provider,
		{ value: worn },
		h(
			"main",
			{
				className: "remote-session",
				// The document is text, so it takes the theme's type and colours instead of the browser's
				// defaults: a serif title and a numbered list are what the page looks like without them.
				style: {
					background: theme.color.background,
					color: theme.color.text,
					fontFamily: theme.font,
					padding: theme.space(4),
					fontSize: theme.type.body.fontSize,
					// A number with no unit is a multiple of the font size in CSS, so this is 1.5 times, not 22.5 px.
					lineHeight: 1.5,
				},
			},
			header(session, theme),
			h(
				"ol",
				{
					className: "remote-transcript",
					// A transcript is a sequence of messages, not a numbered procedure: the index says nothing.
					style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: theme.space(3) },
				},
				...items.flatMap((item) => itemNodes(item, state.promptFrom)),
			),
		),
	);
}

function header(session: ClientSession, theme: Theme): ReactNode {
	const about = aboutOf(session);
	return h(
		"header",
		undefined,
		h(
			"h1",
			{ style: { ...theme.type.title, margin: 0, color: theme.color.text } },
			plain(titleOf(session)),
		),
		h(
			"p",
			{
				className: "remote-about",
				style: { ...theme.type.caption, margin: 0, color: theme.color.muted },
			},
			plain(about.join(" · ")),
		),
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
function messageNodes(
	entry: string,
	message: ChatMessage,
	promptFrom: SessionState["promptFrom"],
): ReactNode[] {
	const parts = partsOf(message.content);
	switch (message.role) {
		case "user":
			return [
				block(entry, "you", h(Markdown, { text: textOf(parts) }), originOf(promptFrom, entry)),
			];
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

function block(key: string, who: string, body: ReactNode, origin?: string): ReactNode {
	return h(Block, { key, who, origin, children: body });
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
	const { theme, accent, agent } = useContext(WornContext);
	// Who is speaking is smaller and heavier than what they say, as it is in the terminal: the person's
	// `❯` takes the theme's accent and the agent's name its own color. A name with no color is drawn in the
	// text color, so no label wears a color nobody chose.
	const color = who === "you" ? accent : who === "pi" ? agent : undefined;
	return h(
		"li",
		{ className: `remote-${who}` },
		h(
			"span",
			{
				className: "remote-who",
				style: {
					...theme.type.label,
					fontWeight: "700",
					color: color ?? theme.color.muted,
				},
			},
			who === "you" ? "\u276F you" : who,
		),
		origin === undefined
			? null
			: h(
					"span",
					{
						className: "remote-from",
						style: { ...theme.type.caption, color: theme.color.muted, marginLeft: theme.space(3) },
					},
					origin,
				),
		children,
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

/** A question the session waits on. It is answered from the terminal or a later version of this app. */
