// The permission asked above the editor: the key that answers it is read by the dialog, and the
// editor under it keeps its text. What the answer becomes is the decision's own test; this is the
// dialog's half.
import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { askViaSelector } from "../src/ui/selector.ts";

interface Drawn {
	render(width: number): string[];
	handleInput(data: string): void;
}

/** A host that draws components, as the terminal one does, and hands back what it built. */
function host(editor: string) {
	let drawn: Drawn | undefined;
	let finish: (value: unknown) => void = () => {};
	let built: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		built = resolve;
	});
	const ui = {
		getEditorText: () => editor,
		custom: (factory: unknown) => {
			drawn = (
				factory as (
					tui: unknown,
					theme: unknown,
					keys: unknown,
					done: (value: unknown) => void,
				) => Drawn
			)({}, {}, {}, (value) => finish(value));
			built();
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
		select: async () => undefined,
		input: async () => undefined,
		notify: () => {},
	};
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: "/repo",
		ui,
	} as unknown as ExtensionContext;
	return {
		ctx,
		ready,
		get lines(): string[] {
			const lines = (drawn as Drawn).render(60);
			return lines;
		},
		type: (data: string) => (drawn as Drawn).handleInput(data),
	};
}

const CALL = { summary: "git push origin main", levels: ["bash:git push"] };

describe("the permission above the editor", () => {
	test("the question, the command and the keys are what the dialog draws", async () => {
		const drawn = host("");
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		const lines = drawn.lines;
		expect(lines[0]).toContain("Allow bash?");
		expect(lines).toContain("git push origin main");
		expect(lines.join("\n")).toContain("1. yes");
		drawn.type("1");
		expect(await answered).toEqual({ decision: "allow" });
	});

	test("the first key it reads is the answer, and a key it does not read is dropped", async () => {
		const drawn = host("");
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		// A letter that is not one of the keys leaves the dialog open, and never reaches the editor.
		drawn.type("y");
		drawn.type("3");
		expect(await answered).toEqual({ decision: "deny" });
	});

	test("escape denies, which is the answer that needs no further key", async () => {
		const drawn = host("");
		const answered = askViaSelector(drawn.ctx, "bash", CALL);
		await drawn.ready;
		drawn.type("\u001b");
		expect(await answered).toEqual({ decision: "deny" });
	});
});
