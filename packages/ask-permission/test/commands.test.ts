import { describe, expect, test } from "bun:test";

import { fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { AlwaysYes } from "#core/always-yes.ts";
import { defaultConfig } from "#core/config/schema.ts";
import { registerCommands } from "#pi/commands.ts";
import type { SessionState } from "#pi/session.ts";

function perm() {
	const fake = fakePi();
	const state = {
		config: defaultConfig(),
		mode: "manual",
		outside: "ask",
		alwaysYes: new AlwaysYes(),
	} as unknown as SessionState;
	registerCommands(fakeScope({ pi: fake }), state);
	const command = fake.commands.get("perm");
	if (!command) throw new Error("/perm was not registered");

	const notes: string[] = [];
	const ctx = {
		mode: "print",
		hasUI: false,
		cwd: "/repo",
		ui: { notify: (text: string) => notes.push(text), setStatus: () => {} },
	} as unknown as ExtensionCommandContext;

	return {
		command,
		state,
		notes,
		entries: fake.entries,
		run: (args: string) => command?.handler(args, ctx),
	};
}

describe("/perm", () => {
	test("suggests every subcommand that starts with what was typed", async () => {
		const { command } = perm();
		const values = async (prefix: string) =>
			((await command.getArgumentCompletions?.(prefix)) ?? []).map(
				(item: { value: string }) => item.value,
			);

		expect(await values("fo")).toEqual([
			"forget",
			"forget project",
			"forget everywhere",
			"forget all",
		]);
		expect(await values("judge t")).toEqual(["judge test"]);
		expect(await values("nope")).toEqual([]);
	});

	test("forget uses the dialog's scope names", async () => {
		const { state, notes, run } = perm();
		state.alwaysYes.add("session", "bash", "git");

		await run("forget");
		expect(state.alwaysYes.total()).toBe(0);
		expect(notes.at(-1)).toContain("forgot 1 always yes from this session");

		await run("forget global");
		expect(notes.at(-1)).toContain("forget takes session, project, everywhere, all");
	});

	test("an unknown subcommand lists the real ones", async () => {
		const { notes, run } = perm();
		await run("reset");
		expect(notes.at(-1)).toContain("/perm takes mode, outside, status, forget, judge");
	});

	test("mode takes a name, the 4.x names too, and cycles without one", async () => {
		const { state, run } = perm();

		await run("mode judge");
		expect(state.mode).toBe("judge");
		await run("mode accept-edits");
		expect(state.mode).toBe("edits");
		await run("mode");
		expect(state.mode).toBe("judge");
	});

	test("outside changes only this session, and the session remembers it", async () => {
		const { state, entries, run } = perm();

		await run("outside");
		expect(state.outside).toBe("allow");
		await run("outside deny");
		expect(state.outside).toBe("deny");
		expect(state.config.workspace.outside).toBe("ask");
		expect(entries).toEqual([
			{ customType: "pi-ask-permission:session", data: { kind: "outside", outside: "allow" } },
			{ customType: "pi-ask-permission:session", data: { kind: "outside", outside: "deny" } },
		]);
	});

	test("outside rejects a value it does not know", async () => {
		const { state, notes, run } = perm();
		await run("outside sometimes");
		expect(state.outside).toBe("ask");
		expect(notes.at(-1)).toContain("outside takes ask, allow, deny");
	});
});
