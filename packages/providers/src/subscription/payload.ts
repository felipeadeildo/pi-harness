import { isObject } from "@adeildo/pi-kit";

import { billingAttribution, CLAUDE_CODE_IDENTITY } from "./billing.ts";

export interface TextBlock {
	type: "text";
	text: string;
	cache_control?: unknown;
}

type Payload = Record<string, unknown>;

export function billToPlan(payload: Payload, version: string): Payload | undefined {
	const system = claudeCodeSystem(payload.system);
	if (system === undefined) return undefined;

	const [identity, ...moved] = system;
	const messages = Array.isArray(payload.messages) ? payload.messages : [];
	const attribution: TextBlock = {
		type: "text",
		text: billingAttribution(firstUserText(messages), version),
	};

	return {
		...payload,
		system: [attribution, identity],
		messages: prependInstructions(messages, moved),
	};
}

function claudeCodeSystem(system: unknown): [TextBlock, ...TextBlock[]] | undefined {
	if (!Array.isArray(system) || !system.every(isTextBlock)) return undefined;
	const [first, ...rest] = system;
	if (first === undefined || !first.text.startsWith(CLAUDE_CODE_IDENTITY)) return undefined;
	return [first, ...rest];
}

function isTextBlock(block: unknown): block is TextBlock {
	return isObject(block) && block.type === "text" && typeof block.text === "string";
}

function firstUserText(messages: readonly unknown[]): string {
	const message = messages.find(isUserMessage);
	if (message === undefined) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content.find(isTextBlock)?.text ?? "";
}

function isUserMessage(message: unknown): message is Payload {
	return isObject(message) && message.role === "user";
}

function prependInstructions(messages: readonly unknown[], moved: readonly TextBlock[]): unknown[] {
	const text = moved
		.map((block) => block.text)
		.filter((part) => part.trim() !== "")
		.join("\n\n");
	if (text === "") return [...messages];

	// The moved prompt takes over pi's cache breakpoint, so the breakpoint count stays the same.
	const cacheControl = moved.findLast((block) => block.cache_control !== undefined)?.cache_control;
	const instructions: TextBlock = {
		type: "text",
		text: `<system-instructions>\n${text}\n</system-instructions>`,
		...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
	};

	const index = messages.findIndex(isUserMessage);
	const target = messages[index];
	if (!isUserMessage(target)) return [{ role: "user", content: [instructions] }, ...messages];

	const updated = [...messages];
	updated[index] = { ...target, content: [instructions, ...contentBlocks(target.content)] };
	return updated;
}

function contentBlocks(content: unknown): unknown[] {
	if (Array.isArray(content)) return content;
	if (typeof content === "string" && content !== "") return [{ type: "text", text: content }];
	return [];
}
