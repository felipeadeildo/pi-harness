import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { Here, type Hooks } from "../src/here.ts";
import { FeedPane, type PaneFocus } from "../src/ui/pane.ts";

let root: string;
let now = 1_000_000;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-room-"));
	process.env.PI_HARNESS_EVENTS = root;
	now = 1_000_000;
});

afterEach(() => {
	for (const here of opened) here.close();
	opened.length = 0;
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
});

const opened: Here[] = [];

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	dim: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

function session(id: string): Here {
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		sendMessage: () => {},
		sendUserMessage: () => {},
		idle: () => true,
		fit: async () => ({ fit: 0.5, reason: "" }),
		changed: () => {},
		show: () => {},
		now: () => now,
		alive: () => true,
		defer: (run) => void setTimeout(run, 0),
	};
	const here = new Here(hooks);
	opened.push(here);
	here.open({ getCwd: () => "/repo", getSessionId: () => id }, undefined);
	return here;
}

function pane(): FeedPane {
	return new FeedPane({
		theme: plain,
		requestRender: () => {},
		now: () => now,
		clock: () => "12:00",
	});
}

function everything(here: Here): PaneFocus {
	return {
		key: "room",
		here,
		title: "repo",
		shows: { item: () => true, typing: () => true, empty: "Nothing said yet." },
	};
}

describe("a room with weeks of messages", () => {
	test("scrolling to the oldest line laid out brings older ones in and keeps the view still", () => {
		const me = session("me");
		for (let at = 0; at < 300; at++) me.post("all", `note ${at}`, "you");
		const view = pane();
		const visible = () => stripTerminalSequences(view.lines(everything(me), 100, 20).join("\n"));
		expect(visible()).toContain("note 299");
		view.scroll(-10_000);
		expect(visible()).toMatch(/note 100\n/);
		view.scroll(-10_000);
		view.scroll(-10_000);
		expect(visible()).toContain("note 0");
	});
});

describe("what the pane points at", () => {
	test("a new focus starts at the newest line again, wherever the last one was scrolled", () => {
		const me = session("me");
		for (let at = 0; at < 60; at++) me.post("all", `note ${at}`, "you");
		const view = pane();
		view.lines(everything(me), 100, 20);
		view.scroll(-10_000);
		const other = { ...everything(me), key: "other", title: "me in repo" };
		const drawn = stripTerminalSequences(view.lines(other, 100, 20).join("\n"));
		expect(drawn).toStartWith("me in repo");
		expect(drawn).toContain("note 59");
	});
});
