import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { globalSettingsPath, MODE, MODE_SET, type PermissionMode } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { configPath } from "#core/config/store.ts";

import piAskPermission from "../src/index.ts";

const BY = { kind: "client", name: "phone", machine: "laptop" } as const;

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
		sessionManager: { getBranch: () => [], getSessionName: () => undefined },
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

test("a mode asked for from outside is applied, announced, and refused before the session starts", async () => {
	const fake = fakePi();
	piAskPermission(fake.pi);
	const scope = { events: fake.pi.events, warn: () => {} };
	// The bridge asks through the contract, so the checks run on a decoded value, as they do in pi.
	const ask = (mode: string) => MODE_SET.current(scope)?.set(mode as PermissionMode, BY);
	expect(() => ask("edits")).toThrow("this session has not started yet");

	const notes: string[] = [];
	const live = {
		...session(),
		ui: { notify: (text: string) => notes.push(text), setStatus: () => {} },
	};
	await fake.fire("session_start", {}, live as unknown as ExtensionContext);
	const seen: (string | undefined)[] = [];
	MODE.onChanged(scope, (mode) => seen.push(mode));

	ask("edits");
	expect(MODE.current(scope)).toBe("edits");
	expect(seen).toEqual(["edits"]);
	expect(notes.at(-1)).toContain("set from phone");
});
