// An entry as it crosses to a client. A tool's output can be tens of kilobytes, and a phone opening a
// busy session would read megabytes of it; the client shows the start and the end, and pi's file keeps
// the whole.

/** Longer text keeps its first and last lines, with a line in between that says how much went. */
export const WIRE_TEXT = 12 * 1024;
const HEAD = 2 * 1024;

export function wireEntry<T>(entry: T): T {
	if (typeof entry !== "object" || entry === null) return entry;
	const message = (entry as { message?: unknown }).message;
	if (typeof message !== "object" || message === null) return entry;
	const { role, content, output } = message as {
		role?: unknown;
		content?: unknown;
		output?: unknown;
	};
	if (role === "toolResult" && Array.isArray(content)) {
		const parts = content.map((part: unknown) =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
				? { ...part, text: cut(String((part as { text?: unknown }).text ?? "")) }
				: part,
		);
		return { ...entry, message: { ...message, content: parts } };
	}
	if (role === "bashExecution" && typeof output === "string")
		return { ...entry, message: { ...message, output: cut(output) } };
	return entry;
}

export function cut(text: string): string {
	if (text.length <= WIRE_TEXT) return text;
	const head = text.slice(0, HEAD);
	const tail = text.slice(text.length - (WIRE_TEXT - HEAD));
	const gone = Math.round((text.length - WIRE_TEXT) / 1024);
	return `${head.slice(0, head.lastIndexOf("\n") + 1 || HEAD)}\n… ${gone} KB not sent to this screen …\n\n${tail.slice(tail.indexOf("\n") + 1)}`;
}
