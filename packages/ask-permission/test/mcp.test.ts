import { describe, expect, test } from "bun:test";

import {
	DEFAULT_MCP_POLICY,
	describeHints,
	isOrchestrator,
	mcpCallOf,
	mcpServers,
	policyFor,
	type ToolFact,
} from "#core/mcp.ts";

function facts(tools: Record<string, ToolFact>) {
	return (toolName: string): ToolFact | undefined => tools[toolName];
}

describe("mcpCallOf", () => {
	test("reads the server and the tool out of the registered name", () => {
		const call = mcpCallOf("mcp__sauron__query_loki_logs", facts({}));
		expect(call).toEqual({ server: "sauron", tool: "query_loki_logs" });
	});

	test("the namespace names the server when the tool name is ambiguous", () => {
		const call = mcpCallOf(
			"mcp__dev_radius__read_file",
			facts({ mcp__dev_radius__read_file: { namespace: { name: "mcp__dev-radius" } } }),
		);
		expect(call?.server).toBe("dev-radius");
	});

	test("a tool that is not from a server is not an MCP call", () => {
		expect(mcpCallOf("bash", facts({}))).toBeUndefined();
		expect(mcpCallOf("mcp", facts({}))).toBeUndefined();
		expect(mcpCallOf("list_mcp_resources", facts({}))).toBeUndefined();
	});
});

describe("policyFor", () => {
	test("falls back to the default", () => {
		expect(policyFor({}, "sauron")).toBe(DEFAULT_MCP_POLICY);
	});

	test("finds a server whatever pi replaced in its name", () => {
		expect(policyFor({ "dev-radius": "deny" }, "dev_radius")).toBe("deny");
		expect(policyFor({ mcp__dev_radius: "allow" }, "dev-radius")).toBe("allow");
		expect(policyFor({ "DEV-RADIUS": "ask" }, "dev_radius")).toBe("ask");
	});
});

describe("mcpServers", () => {
	test("counts the tools of each server, and what they declare", () => {
		const servers = mcpServers([
			{ name: "mcp__sauron__query", annotations: { readOnlyHint: true } },
			{ name: "mcp__sauron__list", annotations: { readOnlyHint: true } },
			{ name: "mcp__sauron__delete", annotations: { destructiveHint: true } },
			{ name: "mcp__sauron__update", annotations: { idempotentHint: true } },
			{ name: "mcp__dorothy__list_domains" },
			{ name: "bash" },
		]);

		expect(servers).toEqual([
			{ server: "dorothy", tools: 1, reads: 0, destructive: 0 },
			{ server: "sauron", tools: 4, reads: 2, destructive: 1 },
		]);
	});
});

describe("describeHints", () => {
	test("says in a word what the tool declares", () => {
		expect(describeHints({ readOnlyHint: true })).toBe("reads");
		expect(describeHints({ destructiveHint: true })).toBe("destructive");
		expect(describeHints({ idempotentHint: true })).toBe("does not say it reads");
		expect(describeHints({})).toBe("does not say it reads");
	});
});

describe("isOrchestrator", () => {
	test("knows the tools that call other tools", () => {
		expect(isOrchestrator("codemode")).toBe(true);
		expect(isOrchestrator("tool_search")).toBe(true);
		expect(isOrchestrator("bash")).toBe(false);
	});
});
