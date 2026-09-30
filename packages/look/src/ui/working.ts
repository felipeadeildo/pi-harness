// What the spinner says. Pi's says "Working" for the whole run; this one says what is happening: the
// newest line of the model's thinking, the tool call it is writing, the command running. It only
// speaks through pi's public `setWorkingMessage`, so pi still owns the spinner and where it sits.

export type Activity =
	| { kind: "waiting" }
	| { kind: "thinking"; tail: string }
	| { kind: "writing" }
	| { kind: "calling"; tool: string }
	| { kind: "running"; tool: string; detail: string };

/** One line, plain text: pi paints the message itself. */
export function describe(activity: Activity): string {
	switch (activity.kind) {
		case "waiting":
			return "Waiting";
		case "thinking":
			return activity.tail === "" ? "Thinking" : `Thinking · ${activity.tail}`;
		case "writing":
			return "Writing";
		case "calling":
			return `Calling ${activity.tool}`;
		case "running":
			return activity.detail === "" ? activity.tool : `${activity.tool} · ${activity.detail}`;
	}
}

interface ContentPart {
	type?: unknown;
	thinking?: unknown;
	name?: unknown;
}

/** The newest line of the thinking so far. Model output, so control characters go. */
export function thinkingTail(content: unknown): string {
	if (!Array.isArray(content)) return "";
	for (let index = content.length - 1; index >= 0; index--) {
		const part = content[index] as ContentPart | undefined;
		if (part?.type !== "thinking" || typeof part.thinking !== "string") continue;
		const lines = part.thinking.split("\n").map(clean).filter(Boolean);
		return lines.at(-1) ?? "";
	}
	return "";
}

/** The name of the tool call being written, when the model is writing one. */
export function callingTool(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const part = content.at(-1) as ContentPart | undefined;
	return part?.type === "toolCall" && typeof part.name === "string" ? part.name : undefined;
}

const DETAIL_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "prompt"];

/** The one argument that says what a tool is doing: the command, the file, the pattern. */
export function toolDetail(args: unknown): string {
	if (typeof args !== "object" || args === null) return "";
	const record = args as Record<string, unknown>;
	for (const key of DETAIL_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.trim() !== "") {
			return clean(value.split("\n").find((line) => line.trim() !== "") ?? "");
		}
	}
	return "";
}

// oxlint-disable-next-line no-control-regex -- escape sequences and control characters are the target
const CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]|[\x00-\x1f\x7f]/g;

function clean(text: string): string {
	return text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}
