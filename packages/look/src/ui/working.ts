// What the spinner says. Pi's says "Working" for the whole run; this one names the state: waiting
// for the first token, thinking, writing, drafting a tool call, running it. The call itself and the
// thinking are already in the transcript above, so the line never repeats them. It only speaks
// through pi's public `setWorkingMessage`, so pi still owns the spinner and where it sits.

export type Activity =
	| { kind: "waiting" }
	| { kind: "thinking" }
	| { kind: "writing" }
	| { kind: "drafting"; tool: string }
	| { kind: "running"; tool: string };

/** One short line, lower case: pi paints the message itself. */
export function describe(activity: Activity): string {
	switch (activity.kind) {
		case "waiting":
		case "thinking":
		case "writing":
			return activity.kind;
		case "drafting":
			return `drafting ${activity.tool.toLowerCase()}`;
		case "running":
			return `running ${activity.tool.toLowerCase()}`;
	}
}

/** The name of the tool call being written, when the model is writing one. */
export function draftedTool(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const part = content.at(-1) as { type?: unknown; name?: unknown } | undefined;
	return part?.type === "toolCall" && typeof part.name === "string" ? part.name : undefined;
}
