// The mark and the name a tool call is drawn with. The mark follows the icon set in the look's
// settings, like every other glyph on the screen.
import type { IconSet } from "./glyphs.ts";

type ToolKind = "shell" | "read" | "search" | "edit" | "web" | "agent" | "mcp" | "other";

const ICONS: Record<IconSet, Record<ToolKind, string>> = {
	nerd: {
		shell: "\u{f120}", // nf-fa-terminal
		read: "\u{f15c}", // nf-fa-file_lines
		search: "\u{f002}", // nf-fa-search
		edit: "\u{f044}", // nf-fa-pencil
		web: "\u{f0ac}", // nf-fa-globe
		agent: "\u{f06a9}", // nf-md-robot
		mcp: "\u{f1e6}", // nf-fa-plug
		other: "\u{f013}", // nf-fa-gear
	},
	unicode: {
		shell: "\u276f",
		read: "\u25a4",
		search: "\u2315",
		edit: "\u270e",
		web: "\u25cd",
		agent: "\u25c6",
		mcp: "\u226b",
		other: "\u25cb",
	},
	ascii: {
		shell: "$",
		read: "=",
		search: "?",
		edit: "+",
		web: "@",
		agent: "*",
		mcp: ">",
		other: "-",
	},
};

const MARKS: Record<IconSet, Record<"running" | "done" | "failed", string>> = {
	nerd: { running: "\u{f04c5}", done: "\u{f00c}", failed: "\u{f00d}" },
	unicode: { running: "\u25f7", done: "\u2713", failed: "\u2717" },
	ascii: { running: "...", done: "ok", failed: "!" },
};

export function stateMark(state: "running" | "done" | "failed", set: IconSet): string {
	return MARKS[set][state];
}

export function toolIcon(toolName: string, set: IconSet): string {
	return ICONS[set][toolKind(toolName)];
}

/** The name as it reads on the frame: an MCP tool says its server rather than `mcp__server__tool`. */
export function toolLabel(toolName: string): string {
	const mcp = toolName.match(/^mcp__([^_]+)__(.+)$/u);
	return mcp === null ? toolName : `${mcp[1]}:${mcp[2]}`;
}

function toolKind(toolName: string): ToolKind {
	if (toolName.startsWith("mcp__")) return "mcp";
	switch (toolName) {
		case "bash":
		case "powershell":
		case "shell":
			return "shell";
		case "read":
		case "ls":
		case "find":
			return "read";
		case "grep":
		case "glob":
		case "tool_search":
			return "search";
		case "edit":
		case "write":
		case "apply_patch":
			return "edit";
		case "web_search":
		case "fetch":
		case "webfetch":
		case "web_fetch":
			return "web";
		case "task":
		case "agent":
		case "subagent":
			return "agent";
		default:
			return "other";
	}
}
