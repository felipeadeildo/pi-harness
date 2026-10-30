import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import piAskPermission from "@adeildo/pi-ask-permission";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import harnessBoard from "../src/board.ts";
import harnessCompact from "../src/compact.ts";
import harnessLook from "../src/look.ts";
import harnessPeers from "../src/peers.ts";
import harnessPermission from "../src/permission.ts";
import harnessProviders from "../src/providers.ts";
import harnessQuestions from "../src/questions.ts";
import harnessRemote from "../src/remote.ts";
import harnessSkills from "../src/skills.ts";
import harnessWeb from "../src/web.ts";

let dir = "";
let previousAgentDir: string | undefined;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-harness-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(dir, { recursive: true, force: true });
});

describe("the harness", () => {
	test("every tool it gives a model has an object at the top of its schema", () => {
		// Providers refuse a tool schema that is not `type: "object"` on the first call; the rig's scripted
		// provider never checks, so only this test sees it.
		const bus = createEventBus();
		const mounted = [
			harnessBoard,
			harnessCompact,
			harnessPeers,
			harnessPermission,
			harnessQuestions,
			harnessRemote,
			harnessSkills,
		].map((mount) => {
			const fake = fakePi(bus);
			mount(fake.pi);
			return fake;
		});
		const tools = mounted.flatMap((fake) => fake.tools);
		expect(tools.map((tool) => tool.name)).toContain("board");
		for (const tool of tools) {
			const schema = JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>;
			expect({ tool: tool.name, type: schema.type }).toEqual({ tool: tool.name, type: "object" });
		}
	});

	// What each piece registers that no other does.
	const MOUNTS: {
		name: string;
		mount: (pi: ExtensionAPI) => void;
		read: (fake: ReturnType<typeof fakePi>) => unknown;
		expected: unknown;
	}[] = [
		{
			name: "permission asks before a call",
			mount: harnessPermission,
			read: (fake) => ({
				gate: fake.count("tool_call") > 0,
				mode: fake.shortcuts.includes("alt+m"),
			}),
			expected: { gate: true, mode: true },
		},
		{
			name: "questions give the model its tool",
			mount: harnessQuestions,
			read: toolsOf,
			expected: ["ask_questions"],
		},
		{
			name: "peers give the model the room",
			mount: harnessPeers,
			read: toolsOf,
			expected: ["peers"],
		},
		{
			name: "the board and its panel",
			mount: harnessBoard,
			read: (fake) => ({ tools: toolsOf(fake), panel: fake.shortcuts.includes("alt+t") }),
			expected: { tools: ["board"], panel: true },
		},
		{
			name: "compact writes the summary",
			mount: harnessCompact,
			read: (fake) => fake.count("session_before_compact") > 0,
			expected: true,
		},
		{
			name: "providers rewrite the request",
			mount: harnessProviders,
			read: (fake) => fake.commands.has("accounts"),
			expected: true,
		},
		{
			name: "remote opens the sessions elsewhere",
			mount: harnessRemote,
			read: (fake) => fake.commands.has("remote"),
			expected: true,
		},
		{
			name: "skills read the message",
			mount: harnessSkills,
			read: (fake) => fake.count("input") > 0,
			expected: true,
		},
		{
			name: "web gives the model the pinned pi-web-access tools",
			mount: harnessWeb,
			read: toolsOf,
			expected: ["web_search", "source_check", "fetch_content", "get_search_content"],
		},
		{
			name: "look draws the end of a run",
			mount: harnessLook,
			read: (fake) => fake.count("agent_end") > 0,
			expected: true,
		},
	];

	test.each(MOUNTS)("$name", ({ mount, read, expected }) => {
		const fake = fakePi(createEventBus());
		mount(fake.pi);
		expect(read(fake)).toEqual(expected);
	});

	test("every piece the package lists is in the table above", () => {
		const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
			pi: { extensions: string[] };
		};
		expect(MOUNTS.length).toBe(pkg.pi.extensions.length);
	});

	test("mounts every feature, one extension each", () => {
		const bus = createEventBus();
		const permission = fakePi(bus);
		const look = fakePi(bus);
		const providers = fakePi(bus);
		harnessPermission(permission.pi);
		harnessLook(look.pi);
		harnessProviders(providers.pi);

		expect(permission.shortcuts).toEqual(["alt+s", "alt+m", "alt+w"]);
		expect(look.count("agent_end")).toBe(1);
		expect(providers.count("before_provider_request")).toBe(1);
		expect(providers.shortcuts).toContain("alt+a");
		expect(providers.commands.has("accounts")).toBe(true);
	});

	test("pi loads every piece: each extension file is in the package's list", () => {
		const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
			pi: { extensions: string[] };
		};
		const pieces = readdirSync(join(import.meta.dir, "..", "src"))
			.filter((file) => file !== "setup.ts")
			.map((file) => `./src/${file}`);
		expect(pkg.pi.extensions.toSorted()).toEqual(pieces.toSorted());
	});

	test("mounts the remote and the board's panel, so one package is the whole install", () => {
		const bus = createEventBus();
		const remote = fakePi(bus);
		const board = fakePi(bus);
		harnessRemote(remote.pi);
		harnessBoard(board.pi);

		expect(remote.commands.has("remote")).toBe(true);
		expect(board.shortcuts).toContain("alt+t");
		expect(board.tools.map((tool) => tool.name)).toContain("board");
	});

	test("the first extension draws the settings screen, and only it", () => {
		const bus = createEventBus();
		const permission = fakePi(bus);
		const look = fakePi(bus);
		harnessPermission(permission.pi);
		harnessLook(look.pi);

		expect(permission.commands.has("harness")).toBe(true);
		expect(look.commands.has("harness")).toBe(false);
		expect(look.shortcuts).not.toContain("alt+s");
	});

	test("with a standalone package installed too, only the first copy runs", async () => {
		const bus = createEventBus();
		const harness = fakePi(bus);
		const standalone = fakePi(bus);

		harnessPermission(harness.pi);
		piAskPermission(standalone.pi);

		expect(harness.shortcuts).toEqual(["alt+s", "alt+m", "alt+w"]);
		expect(standalone.shortcuts).toEqual([]);

		const notes: string[] = [];
		await standalone.fire("session_start", {}, fakeContext(notes));
		expect(notes).toContain(
			"pi-ask-permission: permission: already loaded by pi-harness, so this copy stays off",
		);
	});
});

function toolsOf(fake: ReturnType<typeof fakePi>): string[] {
	return fake.tools.map((tool) => tool.name);
}
