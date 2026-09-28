import { expect, test } from "bun:test";

import type { ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { fakeContext, fakePi, fakeScope } from "../src/testing.ts";

test("a fake pi records what a feature registers", () => {
	const fake = fakePi();
	const scope = fakeScope({ pi: fake });

	scope.registerCommand("perm", { handler: async () => {} });
	scope.registerShortcut("alt+m" as never, { handler: () => {} });
	scope.registerTool({ name: "bash" } as ToolDefinition);
	scope.registerProvider("typesafe", { name: "TypeSafe" });
	scope.appendEntry("pi-ask-permission:judge", [1]);
	scope.sendMessage({ customType: "x", content: "hi", display: true, details: undefined });
	scope.events.emit("harness:something", {});

	expect([...fake.commands.keys()]).toEqual(["perm"]);
	expect(fake.shortcuts).toEqual(["alt+m"]);
	expect(fake.tools.map((tool) => tool.name)).toEqual(["bash"]);
	expect(fake.providers).toEqual([{ name: "typesafe", config: { name: "TypeSafe" } }]);
	expect(fake.entries).toEqual([{ customType: "pi-ask-permission:judge", data: [1] }]);
	expect(fake.messages).toHaveLength(1);
});

test("the scope is the extension API, so anything not wrapped still works", () => {
	const fake = fakePi();
	const scope = fakeScope({ pi: fake });

	scope.appendEntry("custom", { a: 1 });
	expect(fake.entries).toEqual([{ customType: "custom", data: { a: 1 } }]);
});

test("session hooks registered through the scope run when the session starts and stops", async () => {
	const notes: string[] = [];
	const fake = fakePi();
	const scope = fakeScope({ pi: fake, notes });
	const ran: string[] = [];
	scope.onSessionStart(() => void ran.push("start"));
	scope.onShutdown(() => void ran.push("stop"));

	await fake.fire("session_start", {}, fakeContext());
	await fake.fire("session_shutdown", { reason: "quit" }, fakeContext());

	expect(ran).toEqual(["start", "stop"]);
	expect(notes).toEqual([]);
});

test("handlers run in order and fire returns what each one returned", async () => {
	const fake = fakePi();
	const scope = fakeScope({ pi: fake });
	scope.on("tool_call", () => ({ block: true, reason: "first" }));
	scope.on("tool_call", () => ({ block: true, reason: "second" }));

	expect(await fake.fire("tool_call", {}, fakeContext())).toEqual([
		{ block: true, reason: "first" },
		{ block: true, reason: "second" },
	]);
	expect(fake.count("tool_call")).toBe(2);
});

test("a command handler can be called the way pi calls it", async () => {
	const fake = fakePi();
	const scope = fakeScope({ pi: fake });
	const seen: string[] = [];
	scope.registerCommand("perm", { handler: async (args) => void seen.push(args) });

	await fake.commands.get("perm")?.handler("mode auto", {} as ExtensionCommandContext);
	expect(seen).toEqual(["mode auto"]);
});

test("the scope warns into the notes it was given", () => {
	const notes: string[] = [];
	fakeScope({ notes }).warn("something happened");
	expect(notes).toEqual(["something happened"]);
});
