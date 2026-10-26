// The transcript as the page draws it: what you said, the agent's words, and runs of its steps
// (thoughts and tool calls, each with its result), with what is still being written at the end.
import type { ChatMessage, SessionState, TranscriptItem } from "@adeildo/pi-remote-protocol";
import type { Live, LivePart } from "@adeildo/pi-remote-protocol/client";

/** `writing`: its arguments still stream; `pending`: written, and no result came. */
type ToolStatus = "writing" | "pending" | "running" | "done" | "error";

export interface ToolLine {
	kind: "tool";
	id: string;
	name: string;
	args: Record<string, unknown>;
	status: ToolStatus;
	output?: string;
	/** Only the end of a running tool's output travels. */
	truncated?: boolean;
	/** The tool's own result details, as pi's edit tool's `patch`. */
	details?: unknown;
	startedAt?: number;
	durationMs?: number;
}

export interface ThoughtLine {
	kind: "thought";
	id: string;
	text: string;
	streaming: boolean;
	/** Only for a thought this page saw being written. */
	since?: number;
	durationMs?: number;
}

export type StepLine = ToolLine | ThoughtLine;

export type Block =
	| { kind: "you"; id: string; text: string; origin?: string; at?: string }
	| { kind: "text"; id: string; text: string; streaming: boolean }
	| { kind: "steps"; id: string; lines: StepLine[] }
	| { kind: "shell"; id: string; command: string; output: string; exit?: number }
	| { kind: "note"; id: string; label: string; text: string }
	| { kind: "skills"; id: string; skills: Skill[] }
	| { kind: "error"; id: string; text: string };

export interface Skill {
	name: string;
	/** The SKILL.md the agent read, without its frontmatter. */
	text: string;
}

/** The skills pi-skills put in front of a prompt, read from the blocks it wrote. */
export function skillsIn(text: string): Skill[] {
	const skills: Skill[] = [];
	for (const match of text.matchAll(/<skill name="([^"]+)"[^>]*>\n?([\s\S]*?)<\/skill>/g)) {
		const body = (match[2] ?? "").replace(/^References are relative to [^\n]*\n+/, "");
		skills.push({ name: match[1] ?? "", text: body.trim() });
	}
	return skills;
}

interface Part {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}

interface Result {
	output: string;
	error: boolean;
	details?: unknown;
	/** When pi wrote the result, in ms. */
	at?: number;
}

/** What pi wrote; recomputed only when the entries change. */
export function blocksOf(
	items: readonly TranscriptItem[],
	promptFrom: SessionState["promptFrom"],
	thought: Readonly<Record<string, number>> = {},
): Block[] {
	const results = resultsOf(items);
	const blocks: Block[] = [];
	const steps = stepsIn(blocks);
	for (const item of items) {
		switch (item.kind) {
			case "message":
				messageBlocks(item, results, promptFrom, thought, blocks, steps);
				break;
			case "compaction":
				blocks.push({ kind: "note", id: item.entry, label: "Compacted", text: item.summary });
				break;
			case "branch":
				blocks.push({ kind: "note", id: item.entry, label: "Branch summary", text: item.summary });
				break;
			case "model":
				blocks.push({ kind: "note", id: item.entry, label: "Model", text: item.model });
				break;
			case "custom": {
				const skills = item.customType === "pi-skills" ? skillsIn(textOf(partsOf(item.data))) : [];
				if (skills.length > 0) {
					blocks.push({ kind: "skills", id: item.entry, skills });
					break;
				}
				if (item.display === true)
					blocks.push({
						kind: "note",
						id: item.entry,
						label: item.customType,
						text: textOf(partsOf(item.data)),
					});
				break;
			}
			default:
				break;
		}
	}
	return blocks;
}

/** The answer still being written, drawn after what pi wrote. */
export function liveBlocksOf(live: Live): Block[] {
	const message = live.message;
	if (message === undefined || message.ended) return [];
	const blocks: Block[] = [];
	liveBlocks(message.stream, message.parts, blocks, stepsIn(blocks), message.ended);
	return blocks;
}

/** A call pi has not answered yet takes what the bridge says while it runs. */
export function withRunning(line: ToolLine, tools: Live["tools"]): ToolLine {
	const running = tools[line.id];
	if (running === undefined || line.status === "done" || line.status === "error") return line;
	let status: ToolStatus = "running";
	if (running.ended !== undefined) status = running.ended.error ? "error" : "done";
	return {
		...line,
		status,
		output: running.output,
		truncated: running.truncated,
		startedAt: running.startedAt,
		...(running.ended?.durationMs === undefined ? {} : { durationMs: running.ended.durationMs }),
	};
}

function stepsIn(blocks: Block[]): () => StepLine[] {
	return () => {
		const last = blocks.at(-1);
		if (last?.kind === "steps") return last.lines;
		const lines: StepLine[] = [];
		blocks.push({ kind: "steps", id: `steps-${blocks.length}`, lines });
		return lines;
	};
}

function messageBlocks(
	{ entry, message, at }: { entry: string; message: ChatMessage; at?: string },
	results: ReadonlyMap<string, Result>,
	promptFrom: SessionState["promptFrom"],
	thought: Readonly<Record<string, number>>,
	blocks: Block[],
	steps: () => StepLine[],
): void {
	const parts = partsOf(message.content);
	switch (message.role) {
		case "user": {
			const origin = originOf(promptFrom, entry);
			blocks.push({
				kind: "you",
				id: entry,
				text: textOf(parts),
				...(origin === undefined ? {} : { origin }),
				...(at === undefined ? {} : { at }),
			});
			return;
		}
		case "assistant":
			parts.forEach((part, index) => {
				const id = `${entry}:${index}`;
				if (part.type === "text" && (part.text ?? "").trim() !== "")
					blocks.push({ kind: "text", id, text: part.text ?? "", streaming: false });
				else if (part.type === "thinking" && (part.thinking ?? "").trim() !== "") {
					const took = thought[id];
					steps().push({
						kind: "thought",
						id,
						text: part.thinking ?? "",
						streaming: false,
						...(took === undefined ? {} : { durationMs: took }),
					});
				} else if (part.type === "toolCall") steps().push(toolOf(part, id, results, msOf(at)));
			});
			if (message.errorMessage !== undefined)
				blocks.push({ kind: "error", id: `${entry}:error`, text: message.errorMessage });
			return;
		case "bashExecution": {
			const shell = message as ChatMessage & {
				command?: string;
				output?: string;
				exitCode?: number;
			};
			blocks.push({
				kind: "shell",
				id: entry,
				command: shell.command ?? "",
				output: shell.output ?? "",
				...(typeof shell.exitCode === "number" ? { exit: shell.exitCode } : {}),
			});
			return;
		}
		default:
			return;
	}
}

function liveBlocks(
	stream: number,
	parts: readonly LivePart[],
	blocks: Block[],
	steps: () => StepLine[],
	ended: boolean,
): void {
	parts.forEach((part, index) => {
		const id = `live-${stream}:${index}`;
		const writing = !ended && index === parts.length - 1;
		if (part.kind === "text")
			blocks.push({ kind: "text", id, text: part.text, streaming: writing });
		else if (part.kind === "thinking")
			steps().push({
				kind: "thought",
				id,
				text: part.text,
				streaming: writing,
				...(part.since === undefined ? {} : { since: part.since }),
				...(writing || part.since === undefined
					? {}
					: { durationMs: (part.until ?? part.since) - part.since }),
			});
		else
			steps().push({
				kind: "tool",
				id: part.id ?? id,
				name: part.name ?? "tool",
				args: partialArgs(part.text),
				status: writing ? "writing" : "pending",
				...(part.since === undefined ? {} : { startedAt: part.since }),
			});
	});
}

function msOf(at: string | undefined): number | undefined {
	if (at === undefined) return undefined;
	const ms = Date.parse(at);
	return Number.isNaN(ms) ? undefined : ms;
}

/** A call starts when its message is written and ends when its result is. */
function toolOf(
	part: Part,
	id: string,
	results: ReadonlyMap<string, Result>,
	startedAt: number | undefined,
): ToolLine {
	const callId = part.id ?? id;
	const result = results.get(callId);
	const took =
		startedAt === undefined || result?.at === undefined ? undefined : result.at - startedAt;
	const args = typeof part.arguments === "object" && part.arguments !== null ? part.arguments : {};
	return {
		kind: "tool",
		id: callId,
		name: part.name ?? "tool",
		args: args as Record<string, unknown>,
		status: result === undefined ? "pending" : result.error ? "error" : "done",
		...(startedAt === undefined ? {} : { startedAt }),
		...(took === undefined || took < 0 ? {} : { durationMs: took }),
		...(result === undefined
			? {}
			: {
					output: result.output,
					...(result.details === undefined ? {} : { details: result.details }),
				}),
	};
}

function resultsOf(items: readonly TranscriptItem[]): Map<string, Result> {
	const results = new Map<string, Result>();
	for (const item of items) {
		if (item.kind !== "message" || item.message.role !== "toolResult") continue;
		const message = item.message as ChatMessage & {
			toolCallId?: string;
			isError?: boolean;
			details?: unknown;
		};
		if (typeof message.toolCallId !== "string") continue;
		const at = msOf(item.at);
		results.set(message.toolCallId, {
			...(at === undefined ? {} : { at }),
			output: textOf(partsOf(message.content)),
			error: message.isError === true,
			...(message.details === undefined ? {} : { details: message.details }),
		});
	}
	return results;
}

/** A tool call's arguments while they stream: the JSON so far, closed where it stopped. */
export function partialArgs(text: string): Record<string, unknown> {
	for (const attempt of [text, closed(text), closed(text, true)]) {
		try {
			const parsed: unknown = JSON.parse(attempt);
			if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
		} catch {
			// The next attempt closes more.
		}
	}
	return {};
}

/** Closes an open string and every open bracket; `dropKey` also drops a key still waiting for its value. */
function closed(text: string, dropKey = false): string {
	const shut: string[] = [];
	let quoted = false;
	let escaped = false;
	for (const char of text) {
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === "{") shut.push("}");
		else if (char === "[") shut.push("]");
		else if (char === "}" || char === "]") shut.pop();
	}
	let body = escaped ? text.slice(0, -1) : text;
	if (quoted) body += '"';
	body = body.replace(/[\s,:]*$/, "");
	if (dropKey) body = body.replace(/,?\s*"[^"]*"$/, "");
	return body + shut.reverse().join("");
}

function partsOf(content: unknown): Part[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content.filter(
		(part): part is Part =>
			typeof part === "object" && part !== null && typeof (part as Part).type === "string",
	);
}

function textOf(parts: readonly Part[]): string {
	return parts
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

/** The device a message came from; absent does not mean the terminal. */
function originOf(promptFrom: SessionState["promptFrom"], entry: string): string | undefined {
	const by = promptFrom?.[entry];
	if (by === undefined) return undefined;
	const name = by.name.trim();
	return name === "" ? "from a client" : `from ${name}`;
}
