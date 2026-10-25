// The permission asked above the editor: the keys answer it, the editor keeps its text, and the answer
// that says no is never the line that gets cut. What a decision becomes is the decision's own test.
import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { askViaSelector } from "../src/ui/selector.ts";

interface Drawn {
	render(width: number): string[];
	handleInput(data: string): void;
}

/** A host that behaves like pi's terminal: a widget row, one input handler, and the editor's text. */
function host(editor = "", rows = 24) {
	let drawn: Drawn | undefined;
	let input: (data: string) => unknown = () => undefined;
	let text = editor;
	let built: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		built = resolve;
	});
	const ui = {
		getEditorText: () => text,
		setEditorText: (next: string) => {
			text = next;
		},
		setWidget: (_key: string, content: unknown) => {
			if (content === undefined) return;
			drawn = (content as (tui: unknown, theme: unknown) => Drawn)(
				{ terminal: { rows }, requestRender: () => {} },
				{ fg: (_color: string, one: string) => one, bold: (one: string) => one },
			);
			built();
		},
		onTerminalInput: (handler: (data: string) => unknown) => {
			input = handler;
			return () => {};
		},
		select: async () => undefined,
		input: async () => undefined,
		notify: () => {},
	};
	const ctx = { mode: "tui", hasUI: true, cwd: "/repo", ui } as unknown as ExtensionContext;
	return {
		ctx,
		ready,
		get lines(): string[] {
			return (drawn as Drawn).render(60);
		},
		type: (data: string) => input(data),
		get editor(): string {
			return text;
		},
	};
}

const CALL = { summary: "git push origin main", levels: ["bash:git push"] };

describe("the permission above the editor", () => {
	test("the question, the command and the keys are what the row draws", async () => {
		const drawn = host();
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		const shown = drawn.lines.join("\n");
		expect(shown).toContain("Allow bash?");
		expect(shown).toContain("git push origin main");
		expect(shown).toContain("1. yes");
		expect(shown).toContain("esc denies");
		drawn.type("1");
		expect(await answered).toEqual({ decision: "allow" });
	});

	test("a key that is not one of the answers is dropped, and the next one answers", async () => {
		const drawn = host();
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		// A letter reads as neither answer nor escape, so the dialog stays open and the editor is untouched.
		expect(drawn.type("y")).toEqual({ consume: true });
		drawn.type("3");
		expect(await answered).toEqual({ decision: "deny" });
		expect(drawn.editor).toBe("");
	});

	test("escape denies, and the editor keeps what it had", async () => {
		const drawn = host("half a thought");
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		drawn.type("\u001b");
		expect(await answered).toEqual({ decision: "deny" });
		expect(drawn.editor).toBe("half a thought");
	});

	test("a short terminal shortens the list, never the answer that says no", async () => {
		const drawn = host("", 6);
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		const shown = drawn.lines.join("\n");
		expect(shown).toContain("esc denies");
		drawn.type("3");
		expect(await answered).toEqual({ decision: "deny" });
	});
});
