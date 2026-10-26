import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import piAskPermission from "@adeildo/pi-ask-permission";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import { createEventBus } from "@earendil-works/pi-coding-agent";

import harnessBoard from "../src/board.ts";
import harnessCompact from "../src/compact.ts";
import harnessLook from "../src/look.ts";
import harnessPeers from "../src/peers.ts";
import harnessPermission from "../src/permission.ts";
import harnessProviders from "../src/providers.ts";
import harnessQuestions from "../src/questions.ts";
import harnessSkills from "../src/skills.ts";

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
		// A provider refuses a tool whose schema is not `type: "object"` (OpenAI answers `Invalid schema
		// for function 'board'`), and it does so on the session's first call. The scripted provider the
		// rig uses never checks, so this is the only place it can be seen. A union as `parameters` is
		// what breaks it, and it is easy to write again.
		const bus = createEventBus();
		const mounted = [
			harnessBoard,
			harnessCompact,
			harnessPeers,
			harnessPermission,
			harnessQuestions,
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
