// What a call to an MCP server means for the gate. Pi registers each server tool as
// `mcp__<server>__<tool>` and reports the server's own annotations beside it, so the policy here
// decides per server, and a hint the server declares can stand in for the mode.
import type { ToolAnnotations, ToolInfo } from "@earendil-works/pi-coding-agent";

const MCP_PREFIX = "mcp__";

export const MCP_POLICIES = ["ask", "hints", "allow", "deny"] as const;

export type McpPolicy = (typeof MCP_POLICIES)[number];

/** Every server follows its own annotations until I say otherwise. */
export const DEFAULT_MCP_POLICY: McpPolicy = "hints";

/** The words the settings screen uses for a policy. */
export const MCP_POLICY_TEXT: Record<McpPolicy, { label: string; description: string }> = {
	ask: { label: "ask me", description: "every call comes to me" },
	hints: {
		label: "trust hints",
		description: "a call the server says only reads runs; the rest follows the mode",
	},
	allow: { label: "allow", description: "every call runs" },
	deny: { label: "deny", description: "every call is blocked" },
};

/**
 * The tools that drive other tools. Their own call is a script or a search, and every call inside
 * reaches the gate on its own, so asking for the wrapper would ask twice for the same thing.
 */
const ORCHESTRATORS = new Set(["codemode", "tool_search"]);

export interface McpCall {
	/** The server name, as pi knows it. */
	server: string;
	/** The tool inside the server, as the registered name spells it. */
	tool: string;
}

export type ToolFact = Pick<ToolInfo, "namespace" | "annotations">;

export type ToolFacts = (toolName: string) => ToolFact | undefined;

export function isOrchestrator(toolName: string): boolean {
	return ORCHESTRATORS.has(toolName);
}

/** The MCP call behind a tool name, or undefined for anything else. */
export function mcpCallOf(toolName: string, fact: ToolFact | undefined): McpCall | undefined {
	const server = serverOf(toolName, fact);
	if (server === undefined) return undefined;

	return { server, tool: toolOf(toolName, fact, server) };
}

/** Whether two names are the same server, whatever pi replaced in one of them. */
export function sameServer(left: string, right: string): boolean {
	return normalize(left) === normalize(right);
}

/** The policy a server follows: the one set for it, or the default. */
export function policyFor(servers: Readonly<Record<string, McpPolicy>>, server: string): McpPolicy {
	for (const [name, policy] of Object.entries(servers)) {
		if (sameServer(name, server)) return policy;
	}
	return DEFAULT_MCP_POLICY;
}

export interface McpServer {
	server: string;
	tools: number;
	reads: number;
	destructive: number;
}

/** The connected servers, with how many of their tools declare each kind of work. */
export function mcpServers(
	tools: readonly Pick<ToolInfo, "name" | "namespace" | "annotations">[],
): McpServer[] {
	const byServer = new Map<string, McpServer>();

	for (const tool of tools) {
		const server = serverOf(tool.name, tool);
		if (server === undefined) continue;

		const entry = byServer.get(server) ?? { server, tools: 0, reads: 0, destructive: 0 };
		entry.tools++;
		const hints = hintsOf(tool);
		if (hints.readOnlyHint === true) entry.reads++;
		else if (hints.destructiveHint === true) entry.destructive++;
		byServer.set(server, entry);
	}

	return [...byServer.values()].toSorted((left, right) => left.server.localeCompare(right.server));
}

export function describeHints(hints: ToolAnnotations): string {
	if (hints.readOnlyHint === true) return "reads";
	if (hints.destructiveHint === true) return "destructive";
	return "does not say it reads";
}

// A server name reaches us sanitized, so the match ignores what pi replaced: `dev-radius` and
// `dev_radius` are the same server.
function normalize(server: string): string {
	const name = server.startsWith(MCP_PREFIX) ? server.slice(MCP_PREFIX.length) : server;
	return name.trim().toLowerCase().replace(/-/g, "_");
}

function serverOf(toolName: string, fact: ToolFact | undefined): string | undefined {
	const namespace = fact?.namespace?.name;
	if (namespace?.startsWith(MCP_PREFIX) === true) return namespace.slice(MCP_PREFIX.length);
	if (!toolName.startsWith(MCP_PREFIX)) return undefined;

	const rest = toolName.slice(MCP_PREFIX.length);
	const cut = rest.indexOf("__");
	return cut <= 0 ? undefined : rest.slice(0, cut);
}

function toolOf(toolName: string, fact: ToolFact | undefined, server: string): string {
	const namespace = fact?.namespace?.name;
	if (namespace !== undefined && toolName.startsWith(`${namespace}__`))
		return toolName.slice(namespace.length + 2);

	return toolName.slice(MCP_PREFIX.length + server.length + 2);
}

export function hintsOf(fact: ToolFact | undefined): ToolAnnotations {
	return fact?.annotations ?? {};
}
