import { describe, expect, test } from "bun:test";

import {
	closedOf,
	keyBytes,
	retryAfter,
	terminalHref,
	terminalSocketUrl,
	withCtrl,
} from "./terminal-data.ts";

describe("the terminal's address", () => {
	test("the page's and the socket's, each part encoded", () => {
		expect(terminalHref("my box", "shell-1a2b")).toBe("/terminal/my%20box/shell-1a2b");
		expect(
			terminalSocketUrl({ protocol: "http:", host: "127.0.0.1:7878" }, "my box", "shell-1a2b", {
				cols: 80,
				rows: 24,
			}),
		).toBe("ws://127.0.0.1:7878/terminal?machine=my+box&name=shell-1a2b&cols=80&rows=24");
		expect(
			terminalSocketUrl({ protocol: "https:", host: "pi.example" }, "a", "b", { cols: 1, rows: 2 }),
		).toStartWith("wss://pi.example/terminal?");
	});
});

describe("a closed terminal", () => {
	test("a shell that ended, a refusal with its status, and anything else a lost connection", () => {
		expect(closedOf(1000, "the shell ended")).toEqual({ kind: "ended", text: "The shell ended." });
		expect(closedOf(4404, "no terminal named x on laptop")).toEqual({
			kind: "refused",
			status: 404,
			text: "No terminal named x on laptop.",
		});
		expect(closedOf(1006, "")).toEqual({ kind: "lost" });
		expect(closedOf(1001, "going away")).toEqual({ kind: "lost" });
	});

	test("is tried again a little later each time, never past ten seconds", () => {
		expect([0, 1, 2, 3, 4, 5, 9].map(retryAfter)).toEqual([
			500, 1000, 2000, 4000, 8000, 10_000, 10_000,
		]);
	});
});

describe("the phone's key bar", () => {
	test("sends what a keyboard sends, arrows by the cursor mode", () => {
		expect(keyBytes("esc", false)).toBe("\x1b");
		expect(keyBytes("tab", false)).toBe("\t");
		expect(keyBytes("up", false)).toBe("\x1b[A");
		expect(keyBytes("up", true)).toBe("\x1bOA");
		expect(keyBytes("left", true)).toBe("\x1bOD");
	});

	test("Ctrl makes a letter its control character, and leaves the rest alone", () => {
		expect(withCtrl("c")).toBe("\x03");
		expect(withCtrl("C")).toBe("\x03");
		expect(withCtrl("d")).toBe("\x04");
		expect(withCtrl("[")).toBe("\x1b");
		expect(withCtrl("1")).toBe("1");
		expect(withCtrl("ab")).toBe("ab");
	});
});
