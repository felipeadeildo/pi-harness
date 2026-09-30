import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-tui";

import type { DialogAnswer, FolderOffer } from "#core/answer.ts";
import { defaultConfig } from "#core/config/schema.ts";
import { decide, describeCall, gateLayers, type GateState } from "#core/decide.ts";
import { OpenFolders } from "#core/folders.ts";
import { asToolInput, toolAdapter } from "#core/tools.ts";
import { folderChoices, reachOf } from "#core/workspace.ts";
import { fallbackChoices } from "#ui/decision-options.ts";
import { AskDialog } from "#ui/dialog.ts";

let base: string;
let repo: string;
let workspace: string;

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "pi-ask-folders-")));
	repo = join(base, "grace");
	workspace = join(repo, "apps", "api");
	mkdirSync(join(repo, ".git"), { recursive: true });
	mkdirSync(workspace, { recursive: true });
	mkdirSync(join(repo, "apps", "web", "app"), { recursive: true });
	writeFileSync(join(repo, "apps", "web", "app", "a.tsx"), "");
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("reachOf", () => {
	test("keeps every path that left, not only the first", () => {
		const web = join(repo, "apps", "web");
		const reach = reachOf(["."], workspace, [join(web, "app"), "src", join(base, "other")]);
		expect(reach).toEqual({
			kind: "outside",
			path: join(web, "app"),
			paths: [join(web, "app"), join(base, "other")],
		});
	});
});

describe("folderChoices", () => {
	test("goes from the shallowest folder to the one that holds the paths, and suggests the repository", () => {
		const choices = folderChoices([join(repo, "apps", "web", "app", "a.tsx")]);
		expect(choices?.folders.slice(-4)).toEqual([
			repo,
			join(repo, "apps"),
			join(repo, "apps", "web"),
			join(repo, "apps", "web", "app"),
		]);
		expect(choices?.repoRoot).toBe(repo);
		expect(choices && choices.folders[choices.suggested]).toBe(repo);
	});

	test("without a repository, suggests the folder that holds the paths", () => {
		rmSync(join(repo, ".git"), { recursive: true });
		const choices = folderChoices([join(repo, "apps", "web", "app", "a.tsx")]);
		expect(choices?.repoRoot).toBeUndefined();
		expect(choices && choices.folders[choices.suggested]).toBe(join(repo, "apps", "web", "app"));
	});

	test("several paths share their common folder", () => {
		const choices = folderChoices([join(repo, "apps", "web", "app", "a.tsx"), workspace]);
		expect(choices?.folders.at(-1)).toBe(join(repo, "apps"));
	});

	test("never offers the home, the root, or what holds the home", () => {
		expect(folderChoices([join(homedir(), ".bashrc")])).toBeUndefined();
		expect(folderChoices(["/etc/passwd", join(homedir(), "x")])).toBeUndefined();
		expect(folderChoices([join(homedir(), ".ssh", "id_rsa")])?.folders).toEqual([
			join(homedir(), ".ssh"),
		]);
	});
});

describe("OpenFolders", () => {
	test("a read folder lets reads in, a write folder lets everything in", () => {
		const folders = new OpenFolders();
		folders.add("session", repo, "read");
		expect(folders.covers(join(repo, "apps", "web"), "read")).toBe(true);
		expect(folders.covers(join(repo, "apps", "web"), "write")).toBe(false);
		expect(folders.covers(`${repo}-other`, "read")).toBe(false);

		folders.add("session", repo, "write");
		expect(folders.covers(join(repo, "a.ts"), "write")).toBe(true);
		folders.add("session", repo, "read");
		expect(folders.list("session")).toEqual([{ path: repo, access: "write" }]);
	});

	test("a project folder is saved and read back, the home shortened", () => {
		const file = join(base, "folders.json");
		const folders = new OpenFolders();
		folders.open({ global: join(base, "global.json"), project: file });
		expect(folders.add("project", join(homedir(), "Projects", "grace"), "read")).toBeUndefined();
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
			read: ["~/Projects/grace"],
			write: [],
		});

		const again = new OpenFolders();
		again.open({ global: join(base, "global.json"), project: file });
		expect(again.covers(join(homedir(), "Projects", "grace", "x"), "read")).toBe(true);
	});

	test("an untrusted project keeps the folder for this pi only", () => {
		const folders = new OpenFolders();
		folders.open({ global: join(base, "global.json") });
		expect(folders.add("project", repo, "read")).toContain("not trusted");
		expect(folders.covers(repo, "read")).toBe(true);
	});

	test("forget closes one scope", () => {
		const folders = new OpenFolders();
		folders.add("session", repo, "read");
		expect(folders.forget("session").removed).toBe(1);
		expect(folders.total()).toBe(0);
	});
});

function gate(folders: OpenFolders): GateState {
	return {
		config: defaultConfig(),
		mode: "edits",
		outside: "ask",
		alwaysYes: { has: () => false },
		folders,
	};
}

describe("the gate", () => {
	async function by(folders: OpenFolders, toolName: string, input: unknown) {
		const state = gate(folders);
		const result = await decide(
			describeCall(toolName, input, workspace, state.config),
			gateLayers(state),
		);
		return "by" in result ? result.by : result.action;
	}

	const web = () => join(repo, "apps", "web", "app");

	test("a read-only call into an open folder runs like one inside", async () => {
		const folders = new OpenFolders();
		folders.add("session", repo, "read");
		const command = `cd ${web()} && cat a.tsx | head; ls ${web()}`;
		expect(await by(folders, "bash", { command })).toBe("read-only bash");
		expect(await by(folders, "read", { path: join(web(), "a.tsx") })).toBe("allow list");
	});

	test("a read folder does not let a write in", async () => {
		const folders = new OpenFolders();
		folders.add("session", repo, "read");
		expect(await by(folders, "write", { path: join(web(), "a.tsx") })).toBe("workspace");
		expect(await by(folders, "bash", { command: `rm ${web()}/a.tsx` })).toBe("workspace");
	});

	test("a write folder joins the workspace, and the mode decides", async () => {
		const folders = new OpenFolders();
		folders.add("session", repo, "write");
		expect(await by(folders, "write", { path: join(web(), "a.tsx") })).toBe("mode");
	});

	test("a call that also reaches past the open folder still asks", async () => {
		const folders = new OpenFolders();
		folders.add("session", repo, "read");
		expect(await by(folders, "bash", { command: `cat ${web()}/a.tsx /etc/passwd` })).toBe(
			"workspace",
		);
	});
});

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const KEYS = { enter: "\r", left: "\x1b[D", right: "\x1b[C", esc: "\x1b", tab: "\t" };

function offer(access: FolderOffer["access"] = "read"): FolderOffer {
	const folders = [
		"/home/me/Projects/grace",
		"/home/me/Projects/grace/apps",
		"/home/me/Projects/grace/apps/web",
	];
	return { folders, suggested: 0, repoRoot: folders[0], access };
}

describe("the dialog", () => {
	function open(folderOffer?: FolderOffer, reason?: string) {
		const answers: DialogAnswer[] = [];
		const dialog = new AskDialog({
			theme,
			toolName: "bash",
			target: toolAdapter("bash").describe(asToolInput({ command: "cat x" })),
			reason,
			offer: folderOffer,
			keybindings: { matches: () => false } as unknown as KeybindingsManager,
			requestRender: () => {},
			complete: (answer) => answers.push(answer),
		});
		const press = (...keys: string[]) => {
			for (const key of keys) dialog.handleInput(key);
		};
		return { dialog, answers, press, text: () => dialog.render(90).join("\n") };
	}

	test("a read outside starts on opening the suggested folder, for this session", () => {
		const { answers, press, text } = open(offer());
		expect(text()).toContain("\u25b2 reads outside the workspace");
		expect(text()).toContain(
			"\u276f 2  yes, and allow reads in /home/me/Projects/grace  repo root",
		);
		expect(text()).toContain("s keep for this project");

		press(KEYS.enter);
		expect(answers).toEqual([
			{
				decision: "allow",
				note: undefined,
				open: { path: "/home/me/Projects/grace", access: "read", scope: "session" },
			},
		]);
	});

	test("the arrows pick the folder and s keeps it for the project", () => {
		const { answers, press, text } = open(offer());
		press(KEYS.right, KEYS.right, KEYS.right, KEYS.left, "s");
		expect(text()).toContain("allow reads in /home/me/Projects/grace/apps  for this project");
		press(KEYS.enter);
		expect(answers[0]?.open).toEqual({
			path: "/home/me/Projects/grace/apps",
			access: "read",
			scope: "project",
		});
	});

	test("a write outside offers the workspace and starts on the plain yes", () => {
		const { answers, press, text } = open(offer("write"));
		expect(text()).toContain("\u25b2 writes outside the workspace");
		expect(text()).toContain("2  yes, and add /home/me/Projects/grace to the workspace");
		press(KEYS.enter);
		expect(answers).toEqual([{ decision: "allow", note: undefined, remember: undefined }]);
	});

	test("the arrows do nothing on the other answers, and the numbers shift by one", () => {
		const { answers, press, text } = open(offer());
		press("1", KEYS.right);
		expect(text()).toContain("1-4 pick");
		expect(text()).not.toContain("\u2190\u2192 folder");
		press("4", KEYS.enter);
		expect(answers).toEqual([{ decision: "deny", note: undefined, remember: undefined }]);
	});

	test("a note rides along with the folder", () => {
		const { answers, press } = open(offer());
		press(KEYS.tab, ..."ok", KEYS.enter);
		expect(answers[0]).toMatchObject({ note: "ok", open: { path: "/home/me/Projects/grace" } });
	});

	test("without an offer the reason still shows and the menu is the usual one", () => {
		const { text } = open(undefined, "cannot tell which paths this command reaches");
		expect(text()).toContain("\u25b2 cannot tell which paths this command reaches");
		expect(text()).toContain("1-3 pick");
	});

	test("the plain selector offers the suggested folder", () => {
		const labels = fallbackChoices(offer()).map((choice) => choice.label);
		expect(labels.slice(0, 4)).toEqual([
			"yes",
			"yes, with a note",
			"yes, and allow reads in /home/me/Projects/grace",
			"yes, and allow reads in /home/me/Projects/grace, with a note",
		]);
	});
});
