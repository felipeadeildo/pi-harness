// What the bridge sends of pi's own events: the assistant message being written, the tools running,
// and at the end of each turn the entry that message became. Everything else reaches a client as an
// entry. The shapes are those of pi's JSON mode, plus a `stream` number naming each message written.
import type {
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

/** Hands an event to the connection. A droppable one may be lost, and a resync puts it back. */
export type Send = (type: string, data: unknown, options?: { droppable?: boolean }) => boolean;

/** Deltas of one block are joined over this long, so a fast model costs ~30 frames a second. */
export const DELTA_WINDOW_MS = 33;
/** The most of a tool's output that goes out live. The whole output is fetched over HTTP. */
export const OUTPUT_TAIL = 4 * 1024;
/** A running tool's output goes out at most this often. */
export const OUTPUT_EVERY_MS = 100;

type Inner = MessageUpdateEvent["assistantMessageEvent"];
type WireInner = Record<string, unknown> & { type: string; contentIndex?: number; delta?: string };

interface WireUpdate {
	type: "message_update";
	usage: unknown;
	assistantMessageEvent: WireInner;
}

/** The message being written, as the snapshot and a resync carry it. */
export interface Streaming {
	/** Numbers the message among those this runtime streamed, as `stream.bound` refers to it. */
	stream: number;
	message: unknown;
}

const DELTAS: ReadonlySet<string> = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

/**
 * pi's JSON form of an update: no cumulative message and no `partial`, so the stream grows with the
 * text and not with its square. A tool call's start keeps the id and name its partial held.
 */
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

/**
 * The end of a tool's output as text, which is what a screen shows of a call while it runs. Images
 * and details stay behind: the whole result is in the call's entry, and over HTTP.
 */
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
	/** The message that ended in this turn, waiting for `turn_end` to name its entry. */
	#ended: number | undefined;
	#batch: WireUpdate | undefined;
	#flushTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #tools = new Map<string, Tool>();

	constructor(
		private readonly send: Send,
		private readonly now: () => number = () => performance.now(),
	) {}

	/** The message being written, if one is. */
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
		// The arguments are in the message's tool call already, which is where a screen reads them.
		this.send("pi.tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
		});
	}

	/** At most one update per call every `OUTPUT_EVERY_MS`, and the last one held is never lost. */
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

	/** Names the entry the turn's message became, so a client swaps its streamed copy for the entry. */
	turnEnd(event: TurnEndEvent): void {
		this.flush();
		const stream = this.#ended;
		this.#ended = undefined;
		if (stream === undefined) return;
		this.send("stream.bound", { messages: [{ stream, entry: event.messageEntryId }] });
	}

	/** After deltas were dropped: the message as it stands, which replaces whatever the daemon held. */
	resync(): void {
		this.flush();
		if (this.#open !== undefined) this.send("stream.resync", { ...this.#open });
	}

	/**
	 * Sends what the window holds now. Whatever copies the message being written, such as a snapshot,
	 * flushes first, since the copy already holds those deltas and the window would send them again.
	 */
	flush(): void {
		clearTimeout(this.#flushTimer);
		this.#flushTimer = undefined;
		const batch = this.#batch;
		this.#batch = undefined;
		if (batch !== undefined) this.send("pi.message_update", batch, { droppable: true });
	}

	/** Stops the timers, as the session ends. */
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
