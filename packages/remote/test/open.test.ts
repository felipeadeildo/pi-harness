import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { open } from "../src/cli/open.ts";
import { VERSION } from "../src/version.ts";
import { line } from "../src/wire/lines.ts";
import { type FakeDaemon, fakeDaemon, until } from "./fakes.ts";

let dir = "";
let daemon: FakeDaemon | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pr-open-"));
});

afterEach(async () => {
	await daemon?.stop();
	daemon = undefined;
	rmSync(dir, { recursive: true, force: true });
});

describe("pi-remote open", () => {
	test("says hello as cli, asks for a token, and prints and opens the link with it", async () => {
		const path = join(dir, "daemon.sock");
		const listening = await fakeDaemon(path);
		daemon = listening;
		const out: string[] = [];
		const opened: string[] = [];
		const done = open(
			path,
			7878,
			(text) => out.push(text),
			() => {},
			(url) => opened.push(url),
		);
		await until(() => listening.received.some((one) => one.kind === "command"));
		const [hello, command] = listening.received;
		expect(hello).toMatchObject({
			kind: "hello",
			type: "cli",
			data: { protocol: PROTOCOL, version: VERSION },
		});
		expect(command?.type).toBe("token.issue");
		listening.sockets[0]?.write(
			line(envelope("reply", "token.issue", { token: "abc" }, { id: "else" })),
		);
		listening.sockets[0]?.write(
			line(envelope("reply", "token.issue", { token: "xyz" }, { id: command?.id })),
		);
		expect(await done).toBe(0);
		expect(opened).toEqual(["http://127.0.0.1:7878/#token=xyz"]);
		expect(out[0]).toContain("http://127.0.0.1:7878/#token=xyz");
	});

	test("with no daemon says so, opens nothing and fails", async () => {
		const errors: string[] = [];
		const opened: string[] = [];
		const code = await open(
			join(dir, "nothing.sock"),
			7878,
			() => {},
			(text) => errors.push(text),
			(url) => opened.push(url),
		);
		expect(code).toBe(1);
		expect(opened).toEqual([]);
		expect(errors).toEqual(["pi-remote: no daemon answered; it starts with a pi in a terminal"]);
	});
});
