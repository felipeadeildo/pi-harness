// A session's folder as the page reads it: through the daemon, decoded by the client, and never a
// byte from outside the folder.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	DaemonAnswer,
	readChanges,
	readDiff,
	readFile,
	readFolder,
} from "@adeildo/pi-remote-protocol/client";

import { countsOf, PATCH_BYTES, statusOf, TEXT_BYTES } from "../src/daemon/files.ts";
import { bridgeOf, dir, openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

const SESSION = { machine: "laptop", session: "s1" };

/** Never `GIT_DIR` and its kin: under a git hook they point at this repository, not the test's. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			...withoutGit(process.env),
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@t",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@t",
			GIT_CONFIG_GLOBAL: "/dev/null",
		},
	});
}

function withoutGit(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}

/** A repository with one commit, and the session's folder at `cwd` inside it. */
function repository(): { repo: string; outside: string } {
	const repo = join(dir, "repo");
	const outside = join(dir, "outside");
	mkdirSync(join(repo, "src"), { recursive: true });
	mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.txt"), "not yours\n");
	writeFileSync(join(repo, ".gitignore"), "node_modules/\n*.log\n");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
	writeFileSync(join(repo, "src", "gone.ts"), "bye\n");
	writeFileSync(join(repo, "src", "old.ts"), "moving\nalong\n");
	writeFileSync(join(repo, "debug.log"), "noise\n");
	git(repo, "init", "-q");
	git(repo, "add", ".");
	git(repo, "commit", "-qm", "first");
	return { repo, outside };
}

async function session(cwd: string) {
	const { daemon, port, cookie } = await openDaemon();
	const bridge = await bridgeOf("s1", "e1", undefined, undefined, cwd);
	bridge.state([]);
	await until(() => daemon.sessions.get("s1") !== undefined);
	const base = `http://127.0.0.1:${port}`;
	const speaks = ((url: string | URL, init?: RequestInit) =>
		fetch(url, { ...init, headers: { cookie } })) as typeof fetch;
	const status = (route: string) =>
		fetch(`${base}/sessions/laptop/s1/${route}`, { headers: { cookie } }).then(
			(answer) => answer.status,
		);
	return { base, speaks, status };
}

async function refusal(read: Promise<unknown>): Promise<number | undefined> {
	try {
		await read;
		return undefined;
	} catch (error) {
		return error instanceof DaemonAnswer ? error.status : -1;
	}
}

describe("the folder", () => {
	test("folders come first, git's own folder is hidden, and what git ignores is marked", async () => {
		const { repo } = repository();
		const { base, speaks } = await session(repo);
		const root = await readFolder(base, SESSION, "", speaks);
		expect(root.path).toBe("");
		expect(root.entries).toEqual([
			{ name: "node_modules", kind: "dir", ignored: true },
			{ name: "src", kind: "dir" },
			{ name: ".gitignore", kind: "file", size: 20 },
			{ name: "debug.log", kind: "file", size: 6, ignored: true },
			{ name: "README.md", kind: "file", size: 7 },
		]);
		const src = await readFolder(base, SESSION, "src/", speaks);
		expect(src.path).toBe("src");
		expect(src.entries.map((one) => one.name)).toEqual(["a.ts", "gone.ts", "old.ts"]);
	});

	test("a folder outside a repository lists with nothing marked", async () => {
		const plain = join(dir, "plain");
		mkdirSync(join(plain, "sub"), { recursive: true });
		writeFileSync(join(plain, "x.log"), "x");
		const { base, speaks } = await session(plain);
		expect((await readFolder(base, SESSION, "", speaks)).entries).toEqual([
			{ name: "sub", kind: "dir" },
			{ name: "x.log", kind: "file", size: 1 },
		]);
	});
});

describe("a file", () => {
	test("text comes whole, binary comes as its size, and past the limit the text is cut", async () => {
		const { repo } = repository();
		writeFileSync(join(repo, "bin.dat"), Buffer.from([1, 0, 2, 3]));
		writeFileSync(join(repo, "big.txt"), "x".repeat(TEXT_BYTES + 5));
		const { base, speaks } = await session(repo);
		expect(await readFile(base, SESSION, "src/a.ts", speaks)).toEqual({
			path: "src/a.ts",
			size: 20,
			kind: "text",
			text: "export const a = 1;\n",
		});
		expect(await readFile(base, SESSION, "bin.dat", speaks)).toEqual({
			path: "bin.dat",
			size: 4,
			kind: "binary",
		});
		const big = await readFile(base, SESSION, "big.txt", speaks);
		expect(big.kind === "text" && big.text.length).toBe(TEXT_BYTES);
		expect(big).toMatchObject({ size: TEXT_BYTES + 5, truncated: true });
		expect(await refusal(readFile(base, SESSION, "src", speaks))).toBe(400);
	});

	test("no path climbs out of the session's folder, relative or absolute", async () => {
		const { repo, outside } = repository();
		const { base, speaks, status } = await session(join(repo, "src"));
		const read = (path: string) => refusal(readFile(base, SESSION, path, speaks));
		expect(await read("../README.md")).toBe(400);
		expect(await read("a.ts/../../README.md")).toBe(400);
		expect(await read(join(outside, "secret.txt"))).toBe(400);
		expect(await refusal(readFolder(base, SESSION, "..", speaks))).toBe(400);
		expect(await status(`file?path=${encodeURIComponent("..%2FREADME.md")}`)).toBe(404);
		expect(await status("diff?path=..%2FREADME.md")).toBe(400);
	});

	test("a link out of the folder and git's own files stay closed, and a link inside reads", async () => {
		const { repo, outside } = repository();
		symlinkSync(join(outside, "secret.txt"), join(repo, "out.txt"));
		symlinkSync(outside, join(repo, "out"));
		symlinkSync(join(repo, "README.md"), join(repo, "in.md"));
		const atRoot = await session(repo);
		const fromRoot = (path: string) => refusal(readFile(atRoot.base, SESSION, path, atRoot.speaks));
		expect(await fromRoot("out.txt")).toBe(404);
		expect(await fromRoot("out/secret.txt")).toBe(404);
		expect(await refusal(readFolder(atRoot.base, SESSION, "out", atRoot.speaks))).toBe(404);
		expect(await fromRoot(".git/config")).toBe(404);
		expect(await refusal(readFolder(atRoot.base, SESSION, ".git", atRoot.speaks))).toBe(404);
		// A link that stays inside the folder reads like the file it points at.
		expect(await readFile(atRoot.base, SESSION, "in.md", atRoot.speaks)).toMatchObject({
			text: "# repo\n",
		});
	});
});

describe("the changes", () => {
	test("every kind of change since the last commit, with its lines, staged or not", async () => {
		const { repo } = repository();
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\nexport const b = 3;\n");
		rmSync(join(repo, "src", "gone.ts"));
		git(repo, "mv", "src/old.ts", "src/new.ts");
		writeFileSync(join(repo, "src", "staged.ts"), "one\n");
		git(repo, "add", "src/staged.ts");
		writeFileSync(join(repo, "src", "fresh.ts"), "a\nb\nc");
		writeFileSync(join(repo, "more.log"), "ignored\n");
		const { base, speaks } = await session(repo);
		const changes = await readChanges(base, SESSION, speaks);
		if (!changes.repo) throw new Error("the repository was not seen");
		expect(changes.files.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
			{ path: "src/a.ts", status: "modified", added: 2, removed: 1 },
			{ path: "src/fresh.ts", status: "untracked", added: 3, removed: 0 },
			{ path: "src/gone.ts", status: "deleted", added: 0, removed: 1 },
			{ path: "src/new.ts", from: "src/old.ts", status: "renamed", added: 0, removed: 0 },
			{ path: "src/staged.ts", status: "added", added: 1, removed: 0 },
		]);
	});

	test("a session in a subfolder sees only its subfolder, with paths from there", async () => {
		const { repo } = repository();
		writeFileSync(join(repo, "README.md"), "# changed outside\n");
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
		const { base, speaks } = await session(join(repo, "src"));
		expect(await readChanges(base, SESSION, speaks)).toEqual({
			repo: true,
			files: [{ path: "a.ts", status: "modified", added: 1, removed: 1 }],
		});
		const diff = await readDiff(base, SESSION, "a.ts", speaks);
		expect(diff.patch).toContain("-export const a = 1;\n+export const a = 2;");
	});

	test("a folder outside a repository has no changes, and no diff", async () => {
		const plain = join(dir, "plain");
		mkdirSync(plain);
		const { base, speaks } = await session(plain);
		expect(await readChanges(base, SESSION, speaks)).toEqual({ repo: false });
		expect(await refusal(readDiff(base, SESSION, "x", speaks))).toBe(404);
	});

	test("a repository with no commit yet compares against nothing", async () => {
		const fresh = join(dir, "fresh");
		mkdirSync(fresh);
		git(fresh, "init", "-q");
		writeFileSync(join(fresh, "a.txt"), "a\n");
		git(fresh, "add", "a.txt");
		const { base, speaks } = await session(fresh);
		expect(await readChanges(base, SESSION, speaks)).toEqual({
			repo: true,
			files: [{ path: "a.txt", status: "added", added: 1, removed: 0 }],
		});
		expect((await readDiff(base, SESSION, "a.txt", speaks)).patch).toContain("+a");
	});
});

test("the daemon reads the session's folder even when its own environment names another repository", async () => {
	const { repo } = repository();
	writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
	const other = join(dir, "other");
	mkdirSync(other);
	git(other, "init", "-q");
	const was = process.env.GIT_DIR;
	// A daemon started from a git hook inherits the hook's GIT_DIR.
	process.env.GIT_DIR = join(other, ".git");
	try {
		const { base, speaks } = await session(repo);
		expect(await readChanges(base, SESSION, speaks)).toEqual({
			repo: true,
			files: [{ path: "src/a.ts", status: "modified", added: 1, removed: 1 }],
		});
	} finally {
		if (was === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = was;
	}
});

describe("a diff", () => {
	test("a plain patch with a/ and b/ whatever the user's git config says", async () => {
		const { repo } = repository();
		git(repo, "config", "diff.noprefix", "true");
		git(repo, "config", "color.diff", "always");
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
		const { base, speaks } = await session(repo);
		const { patch } = await readDiff(base, SESSION, "src/a.ts", speaks);
		expect(patch).toContain("--- a/src/a.ts\n+++ b/src/a.ts");
		expect(patch).toContain("-export const a = 1;\n+export const a = 2;");
		expect(patch).not.toContain("\u001b[");
	});

	test("an untracked file is all added, and a rename shows where it came from", async () => {
		const { repo } = repository();
		writeFileSync(join(repo, "src", "fresh.ts"), "hello\n");
		git(repo, "mv", "src/old.ts", "src/new.ts");
		const { base, speaks } = await session(repo);
		const fresh = await readDiff(base, SESSION, "src/fresh.ts", speaks);
		expect(fresh.patch).toContain("+++ b/src/fresh.ts");
		expect(fresh.patch).toContain("+hello");
		const moved = await readDiff(base, SESSION, "src/new.ts", speaks);
		expect(moved.patch).toContain("rename from src/old.ts");
		expect(moved.patch).toContain("rename to src/new.ts");
	});

	test("a patch past the limit is cut and says so", async () => {
		const { repo } = repository();
		writeFileSync(join(repo, "src", "a.ts"), `${"y".repeat(99)}\n`.repeat(PATCH_BYTES / 50));
		const { base, speaks } = await session(repo);
		const diff = await readDiff(base, SESSION, "src/a.ts", speaks);
		expect(diff.truncated).toBe(true);
		expect(diff.patch.length).toBe(PATCH_BYTES);
	});

	test("a pathspec is read as a name, never as git's magic", async () => {
		const { repo } = repository();
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
		const { base, speaks } = await session(repo);
		expect((await readDiff(base, SESSION, ":(glob)**", speaks)).patch).toBe("");
		expect((await readDiff(base, SESSION, "src/*.ts", speaks)).patch).toBe("");
	});
});

describe("git's output, parsed", () => {
	test("status: a rename carries its old path, and a copy counts as added", () => {
		const text = "R  new.ts\0old.ts\0C  copy.ts\0orig.ts\0?? fresh.ts\0UU both.ts\0 M a.ts\0";
		expect(statusOf(text, (path) => path)).toEqual([
			{ path: "new.ts", from: "old.ts", status: "renamed" },
			{ path: "copy.ts", status: "added" },
			{ path: "fresh.ts", status: "untracked" },
			{ path: "both.ts", status: "conflicted" },
			{ path: "a.ts", status: "modified" },
		]);
	});

	test("numstat: a rename is counted under its new path, and a binary file is not counted", () => {
		const text = [
			"1\t2\ta.ts",
			"0\t0\t",
			"old.ts",
			"new.ts",
			"-\t-\tpic.png",
			"3\t0\tb.ts",
			"",
		].join("\0");
		expect(Object.fromEntries(countsOf(text, (path) => path))).toEqual({
			"a.ts": { added: 1, removed: 2 },
			"new.ts": { added: 0, removed: 0 },
			"b.ts": { added: 3, removed: 0 },
		});
	});
});
