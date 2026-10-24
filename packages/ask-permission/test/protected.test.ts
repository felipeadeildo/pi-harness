import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { protectedList, provideProtected, type ProtectedList } from "@adeildo/pi-kit";
import { createEventBus } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "#core/config/schema.ts";
import { decide, type Decision, describeCall, type GateState, gateLayers } from "#core/decide.ts";

let root: string;
let remote: string;
let key: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "protected-"));
	remote = join(root, "remote");
	mkdirSync(remote);
	key = join(remote, "machine.key");
	writeFileSync(key, "secret");
	mkdirSync(join(root, "work"));
	symlinkSync(key, join(root, "work", "link"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const LIST: ProtectedList = {
	paths: [],
	sockets: ["127.0.0.1:7777"],
	commands: ["pi-remote"],
};

function gate(overrides: Partial<GateState> = {}): GateState {
	return {
		config: { ...defaultConfig(), workspace: { roots: [root], outside: "allow" } },
		mode: "edits",
		outside: "allow",
		alwaysYes: { has: () => false },
		folders: { covers: () => false },
		protected: () => ({ ...LIST, paths: [remote] }),
		...overrides,
	};
}

function decision(toolName: string, input: unknown, state = gate()): Promise<Decision> {
	const call = describeCall(toolName, input, join(root, "work"), state.config);
	// A judge that approves everything, after the gate's own layers, as the gate adds it.
	const judge = { name: "judge", decide: () => ({ action: "allow" as const }) };
	return decide(call, [...gateLayers(state), judge]);
}

describe("a call that reaches a protected entry", () => {
	test("reading a protected file asks in edits mode, past the judge, and says why", async () => {
		const result = await decision("read", { path: key });
		expect(result).toMatchObject({ action: "ask", by: "protected" });
		expect("reason" in result && result.reason).toContain("which is protected");
	});

	test("an always yes does not let it through", async () => {
		const state = gate({ alwaysYes: { has: () => true } });
		expect(await decision("read", { path: key }, state)).toMatchObject({ by: "protected" });
	});

	test("full lets it through without asking", async () => {
		const result = await decision("read", { path: key }, gate({ mode: "full" }));
		expect(result.action).toBe("allow");
	});

	test("a command reaches it through a symlink, a relative path, the socket or the program", async () => {
		for (const command of [
			"cat link",
			`cat ${join(root, "remote")}/../remote/machine.key`,
			"curl http://127.0.0.1:7777/pair",
			"/usr/local/bin/pi-remote pair",
		]) {
			// oxlint-disable-next-line no-await-in-loop -- one command at a time, so a failure names it
			const result = await decision("bash", { command });
			expect({ command, by: "by" in result ? result.by : undefined }).toEqual({
				command,
				by: "protected",
			});
		}
	});

	test("a call that reaches none of it goes on to the other layers", async () => {
		expect(await decision("read", { path: join(root, "work", "notes.md") })).toMatchObject({
			by: expect.not.stringMatching(/^protected$/),
		});
		expect(await decision("bash", { command: "ls ~" })).not.toMatchObject({ by: "protected" });
	});
});

describe("the protected list in the kit", () => {
	test("every provider adds its entries, read each time someone asks", () => {
		const bus = createEventBus();
		let port = "127.0.0.1:7777";
		provideProtected(bus, () => ({ sockets: [port] }));
		provideProtected(bus, () => ({ paths: ["~/remote"], commands: ["pi-remote"] }));
		expect(protectedList(bus)).toEqual({
			paths: ["~/remote"],
			sockets: ["127.0.0.1:7777"],
			commands: ["pi-remote"],
		});
		port = "127.0.0.1:8888";
		expect(protectedList(bus).sockets).toEqual(["127.0.0.1:8888"]);
	});

	test("with no provider the list is empty, and nothing is protected", () => {
		expect(protectedList(createEventBus())).toEqual({ paths: [], sockets: [], commands: [] });
	});
});
