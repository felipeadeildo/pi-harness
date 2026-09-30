import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AlwaysYes } from "#core/always-yes.ts";
import { defaultConfig } from "#core/config/schema.ts";
import { replay, restoreSession, SESSION_ENTRY, type SessionEntry } from "#pi/session-entries.ts";
import type { SessionState } from "#pi/session.ts";

const START = { mode: "manual", outside: "ask" } as const;

function entry(data: SessionEntry | Record<string, unknown>, customType = SESSION_ENTRY) {
	return { type: "custom", customType, data };
}

describe("replay", () => {
	test("an empty branch starts from the configured mode and outside", () => {
		expect(replay([], START)).toEqual({ mode: "manual", outside: "ask", alwaysYes: [] });
	});

	test("the last mode and the last outside win", () => {
		const branch = [
			entry({ kind: "mode", mode: "full" }),
			entry({ kind: "outside", outside: "allow" }),
			entry({ kind: "mode", mode: "edits" }),
			entry({ kind: "outside", outside: "deny" }),
		];
		expect(replay(branch, START)).toMatchObject({ mode: "edits", outside: "deny" });
	});

	test("a session saved by 4.x comes back in the new names", () => {
		expect(replay([entry({ kind: "mode", mode: "accept-edits" })], START).mode).toBe("edits");
		expect(replay([entry({ kind: "mode", mode: "auto" })], START).mode).toBe("full");
	});

	test("forget drops the always yes before it, not after", () => {
		const branch = [
			entry({ kind: "always-yes", toolName: "bash", level: "git" }),
			entry({ kind: "forget-always-yes" }),
			entry({ kind: "always-yes", toolName: "bash", level: "pnpm test" }),
		];
		expect(replay(branch, START).alwaysYes).toEqual([{ toolName: "bash", level: "pnpm test" }]);
	});

	test("ignores other extensions' entries and malformed data", () => {
		const branch = [
			entry({ kind: "mode", mode: "full" }, "someone-else"),
			entry({ kind: "mode", mode: "nope" }),
			entry({ kind: "outside", outside: "sometimes" }),
			entry({ kind: "always-yes", toolName: "bash" }),
			{ type: "message", role: "user" },
			entry({ kind: "mode", mode: "full" }, `${SESSION_ENTRY}-not`),
		];
		expect(replay(branch, START)).toEqual({ mode: "manual", outside: "ask", alwaysYes: [] });
	});
});

describe("restoreSession", () => {
	test("rebuilds the mode, the outside and this session's always yes from the branch", () => {
		const config = defaultConfig();
		config.workspace.outside = "deny";
		const state = {
			config,
			mode: "manual",
			outside: "ask",
			alwaysYes: new AlwaysYes(),
		} as unknown as SessionState;
		state.alwaysYes.add("session", "bash", "from another branch");

		const branch = [
			entry({ kind: "mode", mode: "full" }),
			entry({ kind: "always-yes", toolName: "bash", level: "git" }),
		];
		const ctx = { sessionManager: { getBranch: () => branch } } as unknown as ExtensionContext;
		restoreSession(state, ctx);

		expect(state.mode).toBe("full");
		expect(state.outside).toBe("deny");
		expect(state.alwaysYes.has("bash", ["git"])).toBe(true);
		expect(state.alwaysYes.has("bash", ["from another branch"])).toBe(false);
	});
});
