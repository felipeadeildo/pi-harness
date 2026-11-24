import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";

import { type ChainStep, chainSteps } from "#core/chain.ts";

const CWD = "/repo";

function steps(command: string, env: NodeJS.ProcessEnv = {}): ChainStep[] | undefined {
	return chainSteps(command, CWD, env);
}

function texts(command: string): string[] | undefined {
	return steps(command)?.map((step) => step.command);
}

function cwdsOf(command: string, text: string): (string | undefined)[] | undefined {
	return steps(command)?.find((step) => step.command === text)?.cwds;
}

describe("splitting a chain", () => {
	test("each command between the operators is a step", () => {
		expect(texts("cd /some/folder && sed -i 's/foo/bar/' file.ts")).toEqual([
			"cd /some/folder",
			"sed -i 's/foo/bar/' file.ts",
		]);
		expect(texts("a; b || c | d & e")).toEqual(["a", "b", "c", "d", "e"]);
		expect(texts("a\nb\n\nc")).toEqual(["a", "b", "c"]);
	});

	test("an operator inside quotes or escaped is part of the command", () => {
		expect(texts(`echo 'a && b' | grep "c;d" && echo x\\;y`)).toEqual([
			"echo 'a && b'",
			`grep "c;d"`,
			"echo x\\;y",
		]);
	});

	test("a redirect that uses & or | stays with its command", () => {
		expect(texts("ls 2>&1 | head")).toEqual(["ls 2>&1", "head"]);
		expect(texts("make &> log && ls >| out")).toEqual(["make &> log", "ls >| out"]);
		expect(texts("make |& tee log")).toEqual(["make", "tee log"]);
	});

	test("a newline after an operator continues the line, and a comment is dropped", () => {
		expect(texts("cd /x &&\n  rm y # gone\nls")).toEqual(["cd /x", "rm y", "ls"]);
	});

	test("a single command is not a chain", () => {
		expect(steps("ls -la")).toBeUndefined();
		expect(steps("ls -la;")).toBeUndefined();
	});

	test("grammar the split cannot follow hands the whole line back", () => {
		for (const command of [
			"echo $(rm -rf ~) && ls",
			"echo `rm -rf ~` && ls",
			"(cd /x && rm y) && ls",
			"cat <<EOF && ls\nx\nEOF",
			"if true; then rm x; fi",
			"for f in a b; do rm $f; done",
			"{ rm x; } && ls",
			"[[ -f a && -f b ]] && ls",
			"D=/x; rm $D/y",
			"export PATH=/tmp:$PATH; ls",
			"source ./env.sh && ls",
			"command cd /x && rm y",
			"a && && b",
			"a |",
			"echo 'open && ls",
		]) {
			expect(steps(command)).toBeUndefined();
		}
	});
});

describe("the folder each step runs in", () => {
	test("cd and exit are control steps, the rest run", () => {
		expect(steps("cd /x || exit 1; rm y")?.map((step) => step.control)).toEqual([
			true,
			true,
			false,
		]);
	});

	test("after cd &&, the next step runs in the new folder", () => {
		expect(cwdsOf("cd /some/folder && rm -rf ~", "rm -rf ~")).toEqual(["/some/folder"]);
		expect(cwdsOf("cd sub && cd ../other && ls", "ls")).toEqual(["/repo/other"]);
		expect(cwdsOf("cd && ls", "ls")).toEqual([homedir()]);
		expect(cwdsOf("cd ~/x && ls", "ls")).toEqual([`${homedir()}/x`]);
	});

	test("after cd ;, the next step may run in either folder, since cd can fail", () => {
		expect(cwdsOf("cd /x; rm y", "rm y")).toEqual(["/x", CWD]);
		expect(cwdsOf("cd /x || exit 1; rm y", "rm y")).toEqual(["/x", CWD]);
	});

	test("after cd ||, the next step runs only where cd failed", () => {
		expect(cwdsOf("cd /x || rm y", "rm y")).toEqual([CWD]);
		expect(cwdsOf("! cd /x && rm y", "rm y")).toEqual([CWD]);
	});

	test("a cd in a pipeline or in the background moves nothing after it", () => {
		expect(cwdsOf("cd /x | cat; rm y", "rm y")).toEqual([CWD]);
		expect(cwdsOf("cd /x & rm y", "rm y")).toEqual([CWD]);
		expect(cwdsOf("cd /x && ls & rm y", "rm y")).toEqual([CWD]);
	});

	test("a folder nothing can read is undefined, for every step after it", () => {
		expect(cwdsOf(`cd "$D" && rm y`, "rm y")).toEqual([undefined]);
		expect(cwdsOf("cd - && rm y", "rm y")).toEqual([undefined]);
		expect(cwdsOf("cd a b && rm y", "rm y")).toEqual([undefined]);
		expect(cwdsOf("pushd /x && rm y", "rm y")).toEqual([undefined]);
		expect(cwdsOf("$CD /x && rm y", "rm y")).toEqual([undefined]);
		expect(chainSteps("cd x && rm y", CWD, { CDPATH: "/elsewhere" })?.[1]?.cwds).toEqual([
			undefined,
		]);
	});

	test("the test command does not hide the folder", () => {
		expect(cwdsOf("[ -d x ] && rm y", "rm y")).toEqual([CWD]);
	});
});
