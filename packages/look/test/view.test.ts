import { beforeAll, describe, expect, test } from "bun:test";

import type { SessionSource, SourceItem } from "@adeildo/pi-kit";
import { initTheme, type SessionEntry, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { lookSnapshot, SessionView } from "../src/view/view.ts";
import { plain, screen, snapshot, widths } from "./helpers.ts";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;

function user(id: string, text: string, parentId: string | null): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "t",
		message: { role: "user", content: text, timestamp: 0 },
	} as SessionEntry;
}

/** A source the test feeds by hand. */
function handFed(): { source: SessionSource; send(item: SourceItem): void; stopped(): boolean } {
	let on: ((item: SourceItem) => void) | undefined;
	let stopped = false;
	return {
		source: {
			open: () => Promise.reject(new Error("unused")),
			follow(_after, listener) {
				on = listener;
				return () => {
					stopped = true;
				};
			},
		},
		send: (item) => on?.(item),
		stopped: () => stopped,
	};
}

function view(rows = 12) {
	const fed = handFed();
	let closed = false;
	let renders = 0;
	const tui = {
		terminal: { rows, columns: 60 },
		requestRender: () => renders++,
	} as unknown as TUI;
	const shown = new SessionView({
		tui,
		theme,
		screen: screen(),
		source: fed.source,
		close: () => {
			closed = true;
		},
	});
	return { fed, shown, closed: () => closed, renders: () => renders };
}

describe("a session over the screen", () => {
	beforeAll(() => initTheme("dark", false));

	test("fills the screen in one frame, with the session's title and its editor box", () => {
		const { fed, shown } = view();
		fed.send({ kind: "entry", entry: user("a", "hello there", null) });
		fed.send({
			kind: "summary",
			summary: { session: "s1", machine: "server", cwd: "/work", name: "Fix the release" },
		});
		const lines = shown.render(60).map(plain);
		expect(lines).toHaveLength(12);
		expect(new Set(widths(lines))).toEqual(new Set([60]));
		expect(lines[0]).toContain("Fix the release @ server");
		expect(lines[0]).toContain("live");
		expect(lines.join("\n")).toContain("hello there");
		expect(lines.join("\n")).toContain("Read only");
		expect(lines.at(-1)).toContain("alt+g back");
	});

	test("scrolled back, it says how much is below, and end follows again", () => {
		const { fed, shown } = view(10);
		let parent: string | null = null;
		for (let index = 0; index < 20; index++) {
			fed.send({ kind: "entry", entry: user(`m${index}`, `message ${index}`, parent) });
			parent = `m${index}`;
		}
		expect(shown.render(60).map(plain).join("\n")).toContain("message 19");
		shown.handleInput("\x1b[5~");
		const back = shown.render(60).map(plain);
		expect(back.join("\n")).not.toContain("message 19");
		expect(back.at(-1)).toContain("more below");
		shown.handleInput("\x1b[F");
		expect(shown.render(60).map(plain).join("\n")).toContain("message 19");
	});

	test("a session that ended says so and keeps its transcript", () => {
		const { fed, shown, renders } = view();
		fed.send({ kind: "entry", entry: user("a", "still here", null) });
		fed.send({ kind: "ended" });
		const lines = shown.render(60).map(plain);
		expect(lines[0]).toContain("ended");
		expect(lines.join("\n")).toContain("still here");
		expect(renders()).toBe(2);
	});

	test("alt+g closes it, and disposing it stops following", () => {
		const { fed, shown, closed } = view();
		shown.handleInput("\x1bg");
		expect(closed()).toBe(true);
		shown.dispose();
		expect(fed.stopped()).toBe(true);
	});
});

describe("your slots, filled from the viewed session", () => {
	test("take its folder, machine, model, thinking and context, and nothing it does not publish", () => {
		const filled = lookSnapshot(snapshot(), {
			session: "s1",
			machine: "server",
			cwd: "/srv/app",
			model: { provider: "anthropic", id: "claude-opus-5-5" },
			thinkingLevel: "medium",
			context: { tokens: 50_000, window: 200_000 },
		});
		expect(filled).toMatchObject({
			cwd: "/srv/app",
			host: "server",
			model: { name: "claude-opus-5-5", provider: "anthropic" },
			thinking: "medium",
			context: { tokens: 50_000, window: 200_000, percent: 25 },
			branch: null,
			git: undefined,
			account: undefined,
		});
	});
});
