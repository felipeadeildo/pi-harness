import { describe, expect, test } from "bun:test";

import { toolInfo } from "@adeildo/pi-kit/testing";

import {
	DEFAULT_MCP_POLICY,
	describeHints,
	isOrchestrator,
	mcpCallOf,
	mcpServers,
	policyFor,
} from "#core/mcp.ts";

describe("mcpCallOf", () => {
	test("reads the server and the tool out of the registered name", () => {
		const call = mcpCallOf("mcp__sauron__query_loki_logs", undefined);
		expect(call).toEqual({ server: "sauron", tool: "query_loki_logs" });
	});

	test("the namespace names the server when the tool name is ambiguous", () => {
		const call = mcpCallOf("mcp__dev_radius__read_file", {
			namespace: { name: "mcp__dev-radius" },
		});
		expect(call?.server).toBe("dev-radius");
	});

	test("a tool that is not from a server is not an MCP call", () => {
		expect(mcpCallOf("bash", undefined)).toBeUndefined();
		expect(mcpCallOf("mcp", undefined)).toBeUndefined();
		expect(
			mcpCallOf("list_mcp_resources", { annotations: { readOnlyHint: true } }),
		).toBeUndefined();
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
			toolInfo("mcp__sauron__query", {
				namespace: { name: "mcp__sauron" },
				annotations: { readOnlyHint: true },
			}),
			toolInfo("mcp__sauron__list", {
				namespace: { name: "mcp__sauron" },
				annotations: { readOnlyHint: true },
			}),
			toolInfo("mcp__sauron__delete", {
				namespace: { name: "mcp__sauron" },
				annotations: { destructiveHint: true },
			}),
			toolInfo("mcp__sauron__update", { namespace: { name: "mcp__sauron" } }),
			toolInfo("mcp__dorothy__list_domains", { namespace: { name: "mcp__dorothy" } }),
			toolInfo("bash"),
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
