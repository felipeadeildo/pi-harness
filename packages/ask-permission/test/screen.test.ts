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
import { fakePi } from "@adeildo/pi-kit/testing";
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

async function started(settings?: unknown) {
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
		modelRegistry: { getAvailable: () => [] },
		ui: { notify: () => {}, setStatus: () => {} },
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
		"Reads",
		"Dialog",
		"Judge",
		"Always yes",
	]);
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
