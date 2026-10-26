// Pi's own events as the bridge sends them, in the shapes of pi's JSON mode plus a `stream` number.
import type {
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

/** A droppable event may be lost; a resync puts it back. */
export type Send = (type: string, data: unknown, options?: { droppable?: boolean }) => boolean;

/** About 30 frames a second for a fast model. */
export const DELTA_WINDOW_MS = 33;
/** The whole output is fetched over HTTP. */
export const OUTPUT_TAIL = 4 * 1024;
export const OUTPUT_EVERY_MS = 100;

type Inner = MessageUpdateEvent["assistantMessageEvent"];
type WireInner = Record<string, unknown> & { type: string; contentIndex?: number; delta?: string };

interface WireUpdate {
	type: "message_update";
	usage: unknown;
	assistantMessageEvent: WireInner;
}

export interface Streaming {
	stream: number;
	message: unknown;
}

const DELTAS: ReadonlySet<string> = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

/** Without the cumulative message, so the stream grows with the text and not with its square. */
function wireUpdate(event: MessageUpdateEvent): WireUpdate {
	const usage = "usage" in event.message ? event.message.usage : undefined;
	return {
		type: "message_update",
		usage,
		assistantMessageEvent: wireInner(event.assistantMessageEvent),
	};
}

function wireInner(inner: Inner): WireInner {
	if (!("partial" in inner)) return { ...inner };
	const { partial, ...rest } = inner;
	if (inner.type !== "toolcall_start") return rest;
	const call = partial.content[inner.contentIndex];
	return call?.type === "toolCall" ? { ...rest, id: call.id, toolName: call.name } : rest;
}

/** The end of a running tool's output as text. The whole result is in the call's entry. */
export function outputTail(result: unknown): { text: string; truncated: boolean } {
	const text = contentOf(result).map(textOf).join("");
	if (text.length <= OUTPUT_TAIL) return { text, truncated: false };
	return { text: text.slice(-OUTPUT_TAIL), truncated: true };
}

function contentOf(result: unknown): unknown[] {
	if (typeof result !== "object" || result === null || !("content" in result)) return [];
	return Array.isArray(result.content) ? result.content : [];
}

function textOf(part: unknown): string {
	if (typeof part !== "object" || part === null || !("text" in part)) return "";
	return typeof part.text === "string" ? part.text : "";
}

interface Tool {
	sentAt: number;
	held?: ToolExecutionUpdateEvent;
	timer?: ReturnType<typeof setTimeout>;
}

export class LiveStream {
	#streams = 0;
	#open: Streaming | undefined;
	#ended: number | undefined;
	#batch: WireUpdate | undefined;
	#flushTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #tools = new Map<string, Tool>();

	constructor(
		private readonly send: Send,
		private readonly now: () => number = () => performance.now(),
	) {}

	get streaming(): Streaming | undefined {
		return this.#open;
	}

	messageStart(event: MessageStartEvent): void {
		if (event.message.role !== "assistant") return;
		this.#streams += 1;
		const stream = this.#streams;
		this.#open = { stream, message: event.message };
		this.send("pi.message_start", { type: "message_start", stream, message: event.message });
	}

	messageUpdate(event: MessageUpdateEvent): void {
		const open = this.#open;
		if (open === undefined || event.message.role !== "assistant") return;
		open.message = event.message;
		const update = wireUpdate(event);
		const inner = update.assistantMessageEvent;
		if (!DELTAS.has(inner.type)) {
			this.flush();
			this.send("pi.message_update", update, { droppable: true });
			return;
		}
		const batch = this.#batch;
		const held = batch?.assistantMessageEvent;
		if (
			batch !== undefined &&
			held?.type === inner.type &&
			held.contentIndex === inner.contentIndex
		) {
			held.delta = `${held.delta ?? ""}${inner.delta ?? ""}`;
			batch.usage = update.usage;
			return;
		}
		this.flush();
		this.#batch = update;
		this.#flushTimer = setTimeout(() => this.flush(), DELTA_WINDOW_MS);
		this.#flushTimer.unref();
	}

	messageEnd(event: MessageEndEvent): void {
		const open = this.#open;
		if (open === undefined || event.message.role !== "assistant") return;
		this.flush();
		this.send("pi.message_end", {
			type: "message_end",
			stream: open.stream,
			message: event.message,
		});
		this.#ended = open.stream;
		this.#open = undefined;
	}

	toolStart(event: ToolExecutionStartEvent): void {
		this.#tools.set(event.toolCallId, { sentAt: Number.NEGATIVE_INFINITY });
		// The arguments are already in the message's tool call.
		this.send("pi.tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
		});
	}

	/** The last update held is never lost. */
	toolUpdate(event: ToolExecutionUpdateEvent): void {
		let tool = this.#tools.get(event.toolCallId);
		if (tool === undefined) {
			tool = { sentAt: Number.NEGATIVE_INFINITY };
			this.#tools.set(event.toolCallId, tool);
		}
		const wait = tool.sentAt + OUTPUT_EVERY_MS - this.now();
		if (wait <= 0) {
			this.#sendUpdate(tool, event);
			return;
		}
		tool.held = event;
		if (tool.timer !== undefined) return;
		tool.timer = setTimeout(() => {
			tool.timer = undefined;
			if (tool.held !== undefined) this.#sendUpdate(tool, tool.held);
		}, wait);
		tool.timer.unref();
	}

	toolEnd(event: ToolExecutionEndEvent): void {
		const tool = this.#tools.get(event.toolCallId);
		clearTimeout(tool?.timer);
		this.#tools.delete(event.toolCallId);
		this.send("pi.tool_execution_end", {
			type: "tool_execution_end",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			isError: event.isError,
			durationMs: event.durationMs,
			output: outputTail(event.result),
		});
	}

	turnEnd(event: TurnEndEvent): void {
		this.flush();
		const stream = this.#ended;
		this.#ended = undefined;
		if (stream === undefined) return;
		this.send("stream.bound", { messages: [{ stream, entry: event.messageEntryId }] });
	}

	/** Replaces whatever the daemon held after deltas were dropped. */
	resync(): void {
		this.flush();
		if (this.#open !== undefined) this.send("stream.resync", { ...this.#open });
	}

	/** Anything that copies the message being written flushes first, or the deltas go out twice. */
	flush(): void {
		clearTimeout(this.#flushTimer);
		this.#flushTimer = undefined;
		const batch = this.#batch;
		this.#batch = undefined;
		if (batch !== undefined) this.send("pi.message_update", batch, { droppable: true });
	}

	stop(): void {
		clearTimeout(this.#flushTimer);
		this.#batch = undefined;
		for (const tool of this.#tools.values()) clearTimeout(tool.timer);
		this.#tools.clear();
	}

	#sendUpdate(tool: Tool, event: ToolExecutionUpdateEvent): void {
		tool.sentAt = this.now();
		tool.held = undefined;
		this.send(
			"pi.tool_execution_update",
			{
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				output: outputTail(event.partialResult),
			},
			{ droppable: true },
		);
	}
}
