// The controls say what the queue says. A test here is about what a person reads and what a click
// sends, not about the daemon, so the client is a stand-in that records.
import { describe, expect, test } from "bun:test";

import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import type { CommandType } from "@adeildo/pi-remote-protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CLIENT_MODES, Composer, dropNow, enterSends, sendNow, stateOf } from "./composer.tsx";

function clientOf(
	queue: Outgoing[] = [],
	held: Outgoing[] = [],
): { client: Client; sent: [CommandType, unknown][]; calls: string[] } {
	const sent: [CommandType, unknown][] = [];
	const calls: string[] = [];
	const client = {
		send: (type: CommandType, data: unknown) => {
			sent.push([type, data]);
			return { id: "c1", type, data, at: 0, state: "waiting" as const };
		},
		outbox: () => ({ all: () => queue, held: () => held }),
		release: (id: string) => void calls.push(`release ${id}`),
		drop: (id: string) => void calls.push(`drop ${id}`),
	} as unknown as Client;
	return { client, sent, calls };
}

const draw = (props: Parameters<typeof Composer>[0]): string =>
	renderToStaticMarkup(createElement(Composer, props));

describe("the composer", () => {
	test("the prompt is writable, and the buttons wait for a draft", () => {
		const { client } = clientOf();
		const html = draw({ client });
		// No plan text: the slice is served, so the composer is the thing itself.
		expect(html).not.toContain("inbox slice");
		// The input is writable, and only the buttons wait, and they wait for a draft.
		expect(html).toContain('aria-label="Prompt"');
		expect(html).not.toContain(
			'<input type="text" placeholder="Write to the session" aria-label="Prompt" name="prompt" value="" disabled',
		);
	});

	test("the thinking picker carries every level pi offers, so a session on max is not blank", () => {
		const { client } = clientOf();
		const html = draw({ client, thinking: "max" });
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"])
			expect(html).toContain(`>${level}</option>`);
		// The level the session is on is the one selected, which a picker that ignores the prop fails.
		expect(html).toMatch(/<select[^>]*name="thinking"[^>]*>.*?<option value="max" selected=""/s);
	});

	test("the mode picker starts on the mode the session is in", () => {
		const { client } = clientOf();
		const html = draw({ client, mode: "judge" });
		expect(html).toMatch(/<select[^>]*name="mode"[^>]*>.*?<option value="judge" selected=""/s);
	});

	test("the controls that the daemon serves are there", () => {
		const { client } = clientOf();
		const html = draw({ client, ask: () => undefined });
		for (const label of ["Abort", "Compact", "Stop", "Rename"]) expect(html).toContain(label);
	});

	test("rename is only there when the screen can ask for a name", () => {
		const { client } = clientOf();
		expect(draw({ client })).not.toContain("Rename");
		expect(draw({ client, ask: () => "the rig" })).toContain("Rename");
	});

	test("the mode picker never offers the full mode, which only a terminal may set", () => {
		const { client } = clientOf();
		const html = draw({ client });
		expect(CLIENT_MODES).toEqual(["manual", "edits", "judge"]);
		expect(html).not.toContain(">full<");
	});

	test("the queue is drawn with what each command is doing", () => {
		const { client } = clientOf([
			{ id: "a", type: "run.abort", data: {}, at: 0, state: "sent" },
			{
				id: "b",
				type: "mode.set",
				data: { mode: "full" },
				at: 0,
				state: "refused",
				why: "a client cannot ask for the full mode",
			},
		]);
		const html = draw({ client });
		expect(html).toContain("sent, no answer yet");
		expect(html).toContain("refused: a client cannot ask for the full mode");
	});

	test("a command that waited past the window can be sent now, or dropped", () => {
		const late: Outgoing = { id: "c1", type: "prompt.send", data: {}, at: 0, state: "waiting" };
		const recent: Outgoing = { id: "c2", type: "run.abort", data: {}, at: 0, state: "waiting" };
		const { client } = clientOf([late, recent], [late]);
		const html = draw({ client });
		// Both states are `waiting`-free: one is waiting (so it can go or be dropped), the other is
		// already out (so there is nothing to decide).
		expect(html).toContain("Send now");
		expect(html).toContain("Drop");
		// One control per state, and the command inside the window says it goes out on its own.
		expect(html.match(/Send now/g)).toHaveLength(1);
		expect(html).toContain("goes out when the daemon answers");
	});

	test("each button does its own thing, which the label cannot prove", () => {
		const { client, calls } = clientOf();
		sendNow(client, "c1");
		dropNow(client, "c2");
		expect(calls).toEqual(["release c1", "drop c2"]);
	});

	test("a state reads as what the person does about it", () => {
		expect(stateOf({ id: "a", type: "run.abort", data: {}, at: 0, state: "waiting" })).toBe(
			"waiting for you",
		);
		expect(stateOf({ id: "a", type: "run.abort", data: {}, at: 0, state: "applied" })).toBe("done");
	});

	test("Enter sends the draft, and Shift+Enter leaves it alone", () => {
		// The gate and every chat field press Enter; a composer that only answers a click means the
		// person types, presses Enter and nothing happens — which is what the browser run found.
		let took = 0;
		expect(enterSends({ key: "Enter" }, () => (took += 1))).toBe(true);
		expect(took).toBe(1);
		expect(enterSends({ key: "Enter", shiftKey: true }, () => (took += 1))).toBe(false);
		expect(enterSends({ key: "a" }, () => (took += 1))).toBe(false);
		expect(took).toBe(1);
	});
});
