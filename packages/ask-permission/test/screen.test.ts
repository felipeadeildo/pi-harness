import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	APPLY,
	type ApplyRequest,
	DONE,
	globalSettingsPath,
	LIST,
	type ListRequest,
	type RowView,
	RUN,
	type TabView,
} from "@adeildo/pi-kit";
import { fakePi, toolInfo } from "@adeildo/pi-kit/testing";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import piAskPermission from "../src/index.ts";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_CODING_AGENT_DIR;
	dir = mkdtempSync(join(tmpdir(), "pi-ask-screen-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

async function started(settings?: unknown, notes: string[] = []) {
	if (settings !== undefined) {
		mkdirSync(dirname(globalSettingsPath()), { recursive: true });
		writeFileSync(globalSettingsPath(), JSON.stringify(settings));
	}
	const fake = fakePi();
	piAskPermission(fake.pi);
	const ctx = {
		mode: "print",
		hasUI: false,
		cwd: dir,
		isProjectTrusted: () => false,
		sessionManager: { getBranch: () => [] },
		modelRegistry: {
			getModelsOfType: (type: string) =>
				type === "classifier"
					? [
							{ provider: "typesafe", id: "jev-latest" },
							{ provider: "opencode", id: "jev-1.13-free" },
							{ provider: "openrouter", id: "typesafe/jev-1.13" },
						]
					: [],
			getProviderAuthStatus: (provider: string) => ({ configured: provider === "opencode" }),
		},
		ui: { notify: (text: string) => notes.push(text), setStatus: () => {} },
	} as unknown as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	const tab = (): TabView => {
		const request: ListRequest = { tabs: [] };
		fake.pi.events.emit(LIST, request);
		const found = request.tabs.find((entry) => entry.title === "Permission");
		if (found === undefined) throw new Error("no Permission tab");
		return found;
	};
	const row = (id: string): RowView => {
		const found = tab().rows.find((entry) => entry.id === id);
		if (found === undefined) throw new Error(`no row ${id}`);
		return found;
	};
	const apply = (id: string, value: unknown, op: ApplyRequest["op"] = "set") => {
		const request = { feature: "permission", id, op, value } as ApplyRequest;
		fake.pi.events.emit(APPLY, request);
		return request.answer;
	};
	const run = (id: string) =>
		new Promise<unknown>((resolve) => {
			const stop = fake.pi.events.on(DONE, (data) => {
				stop();
				resolve(data);
			});
			fake.pi.events.emit(RUN, { feature: "permission", id, request: "r1" });
		});

	return { fake, tab, row, apply, run };
}

test("the tab lists its sections in order", async () => {
	const { tab } = await started();
	expect(tab().sections).toEqual([
		"This session",
		"New sessions",
		"Workspace",
		"MCP servers",
		"Reads",
		"Dialog",
		"Judge",
		"Always yes",
		"Folders",
	]);
});

test("the judge section is a model, a policy, a rigor, and a way to try it", async () => {
	const { tab } = await started();
	const judge = tab()
		.rows.filter((entry) => entry.section === "Judge")
		.map((entry) => entry.label);
	expect(judge).toEqual([
		"Model",
		"Policy",
		"Always ask me",
		"Rigor",
		"Dry run",
		"Test the judge",
		"This session's verdicts",
	]);
});

test("the model row offers every classifier, the ones with a key first", async () => {
	const { row } = await started();
	expect(row("permission.judge.model")).toMatchObject({
		value: "typesafe/jev-latest",
		control: {
			type: "choice",
			custom: true,
			options: [
				{ value: "opencode/jev-1.13-free", description: "ready" },
				{
					value: "openrouter/typesafe/jev-1.13",
					description: "needs /login openrouter",
				},
				{ value: "typesafe/jev-latest", description: "needs /login typesafe" },
			],
		},
	});
});

test("a rigor stands for the thresholds, and picking one drops the numbers set by hand", async () => {
	const { row, apply } = await started({
		permission: { judge: { thresholds: { allow: 0.9 }, riskCeiling: 0.75 } },
	});
	expect(row("judge.rigor").value).toBe("custom");

	expect(apply("judge.rigor", "custom")?.error).toContain("set by hand");
	expect(apply("judge.rigor", "strict")?.error).toBe("not a rigor");
	expect(apply("judge.rigor", "cautious")).toEqual({ error: undefined });
	expect(row("judge.rigor").value).toBe("cautious");
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
		permission: { judge: { rigor: "cautious" } },
	});
});

test("dry run is saved for every project", async () => {
	const { row, apply } = await started();
	expect(row("judge.dryRun")).toMatchObject({ value: false, meta: "saved for every project" });
	expect(apply("judge.dryRun", true)).toEqual({ error: undefined });
	expect(row("judge.dryRun").value).toBe(true);
	expect(apply("judge.dryRun", "yes")?.error).toBe("expected on or off");
});

test("the retired judge keys leave the file, and a judge that was on keeps its mode", async () => {
	const notes: string[] = [];
	const { row } = await started(
		{ permission: { judge: { enabled: true, tools: ["bash"], timeoutMs: 2000 } } },
		notes,
	);
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
		permission: { judge: { timeoutMs: 2000 }, mode: "judge" },
	});
	expect(row("session.mode").value).toBe("judge");
	expect(notes.some((note) => note.includes("removed judge.enabled"))).toBe(true);
	expect(notes.some((note) => note.includes("removed judge.tools"))).toBe(true);
});

test("a session starts from the saved settings, and says where each value comes from", async () => {
	const { row } = await started({ permission: { mode: "edits", workspace: { outside: "allow" } } });

	expect(row("session.mode").value).toBe("edits");
	expect(row("session.outside").value).toBe("allow");
	expect(row("permission.mode")).toMatchObject({
		value: "edits",
		layer: "global",
		fallback: "manual",
	});
	expect(row("permission.readOnlyBash")).toMatchObject({ value: true, layer: "default" });
});

test("a session value changes the session only, and is written into it", async () => {
	const { fake, row, apply } = await started();

	expect(apply("session.mode", "judge")).toEqual({ error: undefined });
	expect(row("session.mode").value).toBe("judge");
	expect(row("permission.mode").value).toBe("manual");
	expect(fake.entries).toContainEqual({
		customType: "pi-ask-permission:session",
		data: { kind: "mode", mode: "judge" },
	});
	expect(apply("session.mode", "sometimes")).toEqual({ error: "not a mode" });
});

test("a setting is checked by its decoder, written to the file, and read back", async () => {
	const { row, apply } = await started();

	expect(apply("permission.judge.thresholds.allow", 2)?.error).toContain("from 0 to 1");
	expect(apply("permission.notes", "message")).toEqual({ error: undefined });
	expect(row("permission.notes")).toMatchObject({ value: "message", layer: "global" });
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
		permission: { notes: "message" },
	});

	expect(apply("permission.notes", undefined, "unset")).toEqual({ error: undefined });
	expect(row("permission.notes")).toMatchObject({ value: "result", layer: "default" });
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({});
});

test("forgetting always yes asks first and empties the list", async () => {
	const { row, run } = await started();
	expect(row("always-yes.session")).toMatchObject({ text: "0 rules", kind: "action" });
	expect(row("always-yes.session").confirm).toContain("Forget every always yes");
	expect(await run("always-yes.session")).toEqual({
		request: "r1",
		error: "nothing to forget for this session",
	});
});

test("the judge log opens as text", async () => {
	const { run } = await started();
	expect(await run("judge.log")).toMatchObject({ request: "r1", text: expect.any(String) });
});

test("a folder row names the one open folder, and closing asks first", async () => {
	const { row, run } = await started();
	expect(row("folders.session")).toMatchObject({ text: "none", kind: "action" });
	expect(row("folders.session").confirm).toContain("Close every folder");
	expect(await run("folders.session")).toEqual({
		request: "r1",
		error: "no folder open for this session",
	});
});

test("a row per MCP server, with what it declares and the policy it follows", async () => {
	const { fake, tab, apply } = await started();
	const servers = () =>
		tab().rows.filter((entry) => entry.section === "MCP servers" && entry.id !== "mcp.none");

	expect(tab().rows.find((entry) => entry.id === "mcp.none")?.text).toBe("none connected");

	fake.allTools.push(
		toolInfo("mcp__sauron__query_loki_logs", {
			namespace: { name: "mcp__sauron" },
			annotations: { readOnlyHint: true },
		}),
		toolInfo("mcp__sauron__delete_dashboard", {
			namespace: { name: "mcp__sauron" },
			annotations: { destructiveHint: true },
		}),
		toolInfo("mcp__dorothy__list_domains", { namespace: { name: "mcp__dorothy" } }),
	);

	expect(servers().map((entry) => entry.id)).toEqual(["mcp.dorothy", "mcp.sauron"]);
	expect(tab().rows.some((entry) => entry.id === "mcp.none")).toBe(false);
	expect(servers()[1]).toMatchObject({
		kind: "value",
		label: "sauron",
		value: "hints",
		control: { type: "choice" },
		description:
			"2 tools, 1 that read, 1 destructive. A call the server says only reads runs; the rest follows the mode.",
		meta: "saved for every project",
	});

	expect(apply("mcp.sauron", "deny")).toEqual({ error: undefined });
	expect(servers()[1]).toMatchObject({ value: "deny" });
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
		permission: { mcp: { servers: { sauron: "deny" } } },
	});
	expect(apply("mcp.sauron", "sometimes")).toEqual({ error: "not an MCP policy" });
});

test("a server the settings name but nothing connected is still listed", async () => {
	const { row } = await started({ permission: { mcp: { servers: { sauron: "deny" } } } });

	expect(row("mcp.sauron")).toMatchObject({
		value: "deny",
		description: "not connected now, so the policy waits. Every call is blocked.",
	});
});

test("a connected server follows the policy saved for it", async () => {
	const { fake, row, tab, apply } = await started({
		permission: { mcp: { servers: { "dev-radius": "allow" } } },
	});
	fake.allTools.push(
		toolInfo("mcp__dev_radius__read_file", { namespace: { name: "mcp__dev_radius" } }),
	);

	const servers = () => tab().rows.filter((entry) => entry.section === "MCP servers");
	expect(servers().map((entry) => entry.id)).toEqual(["mcp.dev_radius"]);
	expect(row("mcp.dev_radius")).toMatchObject({ value: "allow" });

	// The name it is saved under follows the setting, not the way it was typed before.
	expect(apply("mcp.dev_radius", "ask")).toEqual({ error: undefined });
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
		permission: { mcp: { servers: { dev_radius: "ask" } } },
	});
});
