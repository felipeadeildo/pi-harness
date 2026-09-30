import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { globalSettingsPath } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { configPath } from "#core/config/store.ts";

import piAskPermission from "../src/index.ts";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_CODING_AGENT_DIR;
	dir = mkdtempSync(join(tmpdir(), "pi-ask-index-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

function session() {
	return {
		mode: "print",
		hasUI: false,
		cwd: dir,
		isProjectTrusted: () => false,
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {} },
	} as unknown as ExtensionContext;
}

test("loading the extension writes nothing, and a session with no old config writes nothing", async () => {
	const fake = fakePi();
	piAskPermission(fake.pi);
	expect(existsSync(configPath())).toBe(false);

	await fake.fire("session_start", {}, session());

	expect(existsSync(configPath())).toBe(false);
	expect(existsSync(globalSettingsPath())).toBe(false);
});

test("the first session moves an old config into the shared settings", async () => {
	mkdirSync(dirname(configPath()), { recursive: true });
	writeFileSync(configPath(), JSON.stringify({ notes: "message" }));

	const fake = fakePi();
	piAskPermission(fake.pi);
	await fake.fire("session_start", {}, session());

	expect(existsSync(configPath())).toBe(false);
	expect(existsSync(`${configPath()}.bak`)).toBe(true);
	expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
		permission: { notes: "message" },
	});
});

test("a session starts from the saved settings", async () => {
	mkdirSync(dirname(globalSettingsPath()), { recursive: true });
	writeFileSync(
		globalSettingsPath(),
		JSON.stringify({ permission: { mode: "edits", workspace: { outside: "allow" } } }),
	);

	const notes: string[] = [];
	const next = fakePi();
	piAskPermission(next.pi);
	const ctx = {
		...session(),
		ui: { notify: (text: string) => notes.push(text), setStatus: () => {} },
	};
	await next.fire("session_start", {}, ctx as unknown as ExtensionContext);
	await next.commands.get("perm")?.handler("status", ctx as never);

	expect(notes.at(-1)).toContain("this session: mode edits \u00b7 outside allow");
	expect(notes.at(-1)).toContain("new sessions: mode edits \u00b7 outside allow");
});

test("Alt+M and Alt+W are both registered", () => {
	const fake = fakePi();
	piAskPermission(fake.pi);
	expect(fake.shortcuts).toEqual(["alt+m", "alt+w"]);
});
