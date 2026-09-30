export type Activity =
	| { kind: "waiting" }
	| { kind: "thinking" }
	| { kind: "writing" }
	| { kind: "drafting"; tool: string }
	| { kind: "running"; tool: string };

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

export function draftedTool(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const part = content.at(-1) as { type?: unknown; name?: unknown } | undefined;
	return part?.type === "toolCall" && typeof part.name === "string" ? part.name : undefined;
}
