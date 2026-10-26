import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionActivity } from "@adeildo/pi-remote-protocol";

import {
	aboutOf,
	Activity,
	answerOf,
	branchOf,
	saidOf,
	watchBranch,
} from "../src/bridge/activity.ts";

function tracked(): { activity: Activity; sent: SessionActivity[] } {
	let clock = 0;
	const sent: SessionActivity[] = [];
	const activity = new Activity(
		"/repo",
		(one) => sent.push(one),
		() => (clock += 10),
	);
	return { activity, sent };
}

describe("the activity", () => {
	test("follows a run: thinking, writing, a tool, then resting", () => {
		const { activity, sent } = tracked();
		activity.started();
		activity.streamed("thinking_delta");
		activity.streamed("text_delta");
		activity.toolStarted("t1", "bash", { command: "bun test\nmore" });
		activity.toolEnded("t1");
		activity.settled();
		expect(sent.map((one) => [one.what, one.tool, one.about])).toEqual([
			["thinking", undefined, undefined],
			["writing", undefined, undefined],
			["tool", "bash", "bun test"],
			["thinking", undefined, undefined],
			["resting", undefined, undefined],
		]);
	});

	test("says nothing when nothing changed, and keeps the time it started", () => {
		const { activity, sent } = tracked();
		activity.streamed("text_delta");
		activity.streamed("text_delta");
		activity.streamed("text_start");
		expect(sent).toHaveLength(1);
		expect(activity.current?.since).toBe(10);
	});

	test("a call still running keeps the line when another ends, and text streamed meanwhile does not take it", () => {
		const { activity, sent } = tracked();
		activity.toolStarted("a", "read", { path: "/repo/src/a.ts" });
		activity.toolStarted("b", "bash", { command: "ls" });
		activity.streamed("text_delta");
		activity.toolEnded("b");
		expect(sent.at(-1)).toMatchObject({ what: "tool", tool: "read", about: "src/a.ts" });
	});
});

describe("the readers", () => {
	test("a tool's subject is its command, path or pattern, on one line and short", () => {
		expect(aboutOf({ path: "/elsewhere/x.ts" }, "/repo")).toBe("/elsewhere/x.ts");
		expect(aboutOf({ pattern: "TODO" }, "/repo")).toBe("TODO");
		expect(aboutOf({ command: "x".repeat(300) }, "/repo")?.length).toBe(120);
		expect(aboutOf({ code: "1 + 1" }, "/repo")).toBeUndefined();
		expect(aboutOf("not an object", "/repo")).toBeUndefined();
	});

	test("the said line is the first line of prose, without its markdown", () => {
		expect(saidOf("```ts\ncode\n```\n## **Done**: the `fix` landed")).toBe("Done: the fix landed");
		expect(saidOf("\n\n- first point\n- second")).toBe("first point");
		expect(saidOf("   ")).toBeUndefined();
	});

	test("an answer's text is its text parts, whatever else it carries", () => {
		const content = [
			{ type: "thinking", thinking: "hm" },
			{ type: "text", text: "one" },
			{ type: "toolCall", name: "bash" },
			{ type: "text", text: "two" },
		];
		expect(answerOf({ content })).toBe("\none\n\ntwo");
		expect(answerOf({ content: "plain" })).toBe("plain");
	});
});

describe("the branch", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "branch-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	test("is read from the repository above the folder, and a detached head is its short hash", () => {
		mkdirSync(join(root, ".git"));
		mkdirSync(join(root, "deep", "er"), { recursive: true });
		writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feat/x\n");
		expect(branchOf(join(root, "deep", "er"))).toBe("feat/x");
		writeFileSync(join(root, ".git", "HEAD"), "0123456789abcdef\n");
		expect(branchOf(root)).toBe("0123456");
	});

	test("a worktree's .git file points at the folder that holds its head", () => {
		const real = join(root, "main.git", "worktrees", "w");
		mkdirSync(real, { recursive: true });
		writeFileSync(join(real, "HEAD"), "ref: refs/heads/side\n");
		mkdirSync(join(root, "w"));
		writeFileSync(join(root, "w", ".git"), `gitdir: ${real}\n`);
		expect(branchOf(join(root, "w"))).toBe("side");
	});

	test("is absent outside a repository", () => {
		expect(branchOf(root)).toBeUndefined();
	});
});

describe("the branch", () => {
	test("is read again when another terminal switches it", async () => {
		const repo = mkdtempSync(join(tmpdir(), "pi-remote-branch-"));
		mkdirSync(join(repo, ".git"));
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		const seen: (string | undefined)[] = [];
		const stop = watchBranch(repo, () => seen.push(branchOf(repo)));
		try {
			// Git writes a lock and renames it over HEAD.
			writeFileSync(join(repo, ".git", "HEAD.lock"), "ref: refs/heads/feat/x\n");
			renameSync(join(repo, ".git", "HEAD.lock"), join(repo, ".git", "HEAD"));
			const deadline = Date.now() + 2_000;
			while (seen.length === 0 && Date.now() < deadline) await Bun.sleep(20);
			expect(seen.at(-1)).toBe("feat/x");
		} finally {
			stop();
			rmSync(repo, { recursive: true, force: true });
		}
	});
});
