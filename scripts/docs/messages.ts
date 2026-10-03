// The two voices of a session, drawn by pi's own components so a picture reads like the real thing.
import {
	AssistantMessageComponent,
	getMarkdownTheme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

/** The width of the screen the message is drawn on, so its background reaches the edge. */
export function userMessage(text: string, width: number): string[] {
	return new UserMessageComponent(text, getMarkdownTheme(), 0).render(width);
}

export function assistantText(text: string, width: number): string[] {
	const message = new AssistantMessageComponent(
		{
			role: "assistant",
			content: [{ type: "text", text }],
			provider: "anthropic",
			api: "anthropic-messages",
			model: "claude-opus-5-5",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
			stopReason: "stop",
			timestamp: 0,
		} as never,
		false,
		getMarkdownTheme(),
		"thinking",
		0,
	);
	return message.render(width);
}
