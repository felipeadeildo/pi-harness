// What is still happening: the answer being written and the tools still running. Pi writes neither to
// the session until it ends, so a client builds them from the bridge's `pi.*` events.
import { isObject } from "../index.ts";

export interface LivePart {
	kind: "text" | "thinking" | "toolCall";
	text: string;
	/** For a tool call: its id and name, known from the start. */
	id?: string;
	name?: string;
	/** A tool call's arguments as an object, when the client joined after they began: the deltas
	 * that follow cannot be appended to it, so the part keeps what it had. */
	settled?: boolean;
	/** This client's clock: when the part began and when it last grew. Unknown for a part the
	 * client found already started. */
	since?: number;
	until?: number;
}

export interface LiveMessage {
	stream: number;
	parts: LivePart[];
	ended: boolean;
}

export interface LiveTool {
	id: string;
	name: string;
	/** This client's clock: the bridge does not send when a tool started. */
	startedAt: number;
	output: string;
	/** Only the end of the output travels live. */
	truncated: boolean;
	ended?: { error: boolean; durationMs?: number };
}

export interface Live {
	message?: LiveMessage;
	tools: Record<string, LiveTool>;
	/** How long each thought this client saw took, by `<entry id>:<part index>`. */
	thought?: Record<string, number>;
}

export const NOTHING_LIVE: Live = { tools: {} };

export function isLiveType(type: string): boolean {
	return type.startsWith("pi.") || type === "stream.resync";
}

/** Returns the same object when the event changes nothing. */
export function foldLive(live: Live, type: string, data: unknown, now: number): Live {
	if (!isObject(data)) return live;
	switch (type) {
		case "pi.message_start":
		case "stream.resync":
			return typeof data.stream === "number"
				? { ...live, message: messageOf(data.stream, data.message, false) }
				: live;
		case "pi.message_update": {
			if (live.message === undefined) return live;
			const message = updated(live.message, data.assistantMessageEvent, now);
			return message === live.message ? live : { ...live, message };
		}
		case "pi.message_end": {
			if (live.message === undefined) return live;
			const held = live.message.parts;
			const ended = messageOf(live.message.stream, data.message, true);
			const parts = ended.parts.map((part, index) => {
				const was = held[index];
				return was?.since === undefined
					? part
					: { ...part, since: was.since, until: was.until ?? now };
			});
			return { ...live, message: { ...ended, parts } };
		}
		case "pi.tool_execution_start":
			return typeof data.toolCallId === "string"
				? withTool(live, {
						id: data.toolCallId,
						name: typeof data.toolName === "string" ? data.toolName : "tool",
						startedAt: now,
						output: "",
						truncated: false,
					})
				: live;
		case "pi.tool_execution_update":
		case "pi.tool_execution_end": {
			const tool = typeof data.toolCallId === "string" ? live.tools[data.toolCallId] : undefined;
			if (tool === undefined) return live;
			const output = isObject(data.output) ? data.output : {};
			const next: LiveTool = {
				...tool,
				output: typeof output.text === "string" ? output.text : tool.output,
				truncated: output.truncated === true,
			};
			if (type === "pi.tool_execution_end") {
				next.ended = {
					error: data.isError === true,
					...(typeof data.durationMs === "number" ? { durationMs: data.durationMs } : {}),
				};
			}
			return withTool(live, next);
		}
		default:
			return live;
	}
}

/** The opening's `streaming`: the answer being written when the client arrived. */
export function liveFromOpening(live: Live, streaming: unknown): Live {
	if (!isObject(streaming) || typeof streaming.stream !== "number") {
		const { message: _gone, ...rest } = live;
		return rest;
	}
	return { ...live, message: messageOf(streaming.stream, streaming.message, false) };
}

/** An entry that pi wrote ends what was live for it: the answer, or the tool whose result it is. */
export function settledBy(live: Live, entry: unknown): Live {
	if (!isObject(entry) || entry.type !== "message" || !isObject(entry.message)) return live;
	const message = entry.message;
	if (message.role === "assistant" && live.message !== undefined) {
		const { message: written, ...rest } = live;
		const thought = { ...rest.thought };
		written.parts.forEach((part, index) => {
			if (part.kind === "thinking" && part.since !== undefined && typeof entry.id === "string")
				thought[`${entry.id}:${index}`] = (part.until ?? part.since) - part.since;
		});
		const kept = Object.entries(thought).slice(-KEPT_THOUGHTS);
		return kept.length === 0 ? rest : { ...rest, thought: Object.fromEntries(kept) };
	}
	if (message.role === "toolResult" && typeof message.toolCallId === "string") {
		if (live.tools[message.toolCallId] === undefined) return live;
		const { [message.toolCallId]: _done, ...tools } = live.tools;
		return { ...live, tools };
	}
	return live;
}

function withTool(live: Live, tool: LiveTool): Live {
	return { ...live, tools: { ...live.tools, [tool.id]: tool } };
}

function messageOf(stream: number, message: unknown, ended: boolean): LiveMessage {
	const content = isObject(message) && Array.isArray(message.content) ? message.content : [];
	return { stream, parts: content.flatMap(partOf), ended };
}

function partOf(part: unknown): LivePart[] {
	if (!isObject(part)) return [];
	if (part.type === "text" && typeof part.text === "string")
		return [{ kind: "text", text: part.text }];
	if (part.type === "thinking" && typeof part.thinking === "string")
		return [{ kind: "thinking", text: part.thinking }];
	if (part.type === "toolCall") {
		const raw = typeof part.partialJson === "string" ? part.partialJson : undefined;
		return [
			{
				kind: "toolCall",
				text: raw ?? JSON.stringify(part.arguments ?? {}),
				...(raw === undefined ? { settled: true } : {}),
				...(typeof part.id === "string" ? { id: part.id } : {}),
				...(typeof part.name === "string" ? { name: part.name } : {}),
			},
		];
	}
	return [];
}

/** Pi's `assistantMessageEvent`: a `*_start` opens part `contentIndex`, a `*_delta` appends to it. */
const KEPT_THOUGHTS = 200;

function updated(message: LiveMessage, event: unknown, now: number): LiveMessage {
	if (!isObject(event) || typeof event.type !== "string") return message;
	const index = typeof event.contentIndex === "number" ? event.contentIndex : -1;
	if (index < 0) return message;
	const kind = kindOf(event.type);
	if (kind === undefined) return message;
	const parts = [...message.parts];
	const held = parts[index];
	if (event.type.endsWith("_start") || held === undefined) {
		parts[index] =
			held?.kind === kind
				? held
				: {
						kind,
						text: "",
						since: now,
						...(typeof event.id === "string" ? { id: event.id } : {}),
						...(typeof event.toolName === "string" ? { name: event.toolName } : {}),
					};
	}
	if (event.type.endsWith("_delta") && typeof event.delta === "string") {
		const part = parts[index];
		if (part !== undefined && part.settled !== true)
			parts[index] = { ...part, text: part.text + event.delta, until: now };
	}
	return { ...message, parts };
}

function kindOf(type: string): LivePart["kind"] | undefined {
	if (type.startsWith("text")) return "text";
	if (type.startsWith("thinking")) return "thinking";
	if (type.startsWith("toolcall")) return "toolCall";
	return undefined;
}
