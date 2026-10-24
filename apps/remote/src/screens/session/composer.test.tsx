// The controls say what the queue says. A test here is about what a person reads and what a click
// sends, not about the daemon, so the client is a stand-in that records.
import { describe, expect, test } from "bun:test";

import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import type { CommandType } from "@adeildo/pi-remote-protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CLIENT_MODES, Composer, dropNow, sendNow, stateOf } from "./composer.tsx";

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
		outbox: () => ({
			all: () => queue,
			held: () => held,
			release: (id: string) => void calls.push(`release ${id}`),
			drop: (id: string) => void calls.push(`drop ${id}`),
		}),
	} as unknown as Client;
	return { client, sent, calls };
}

const draw = (props: Parameters<typeof Composer>[0]): string =>
	renderToStaticMarkup(createElement(Composer, props));

describe("the composer", () => {
	test("the prompt is disabled with the reason, when the daemon does not serve it", () => {
		const { client } = clientOf();
		const html = draw({ client, canPrompt: false });
		expect(html).toContain("Prompts need the inbox slice");
		expect(html).toContain("waiting for the inbox slice");
		expect(html).toContain("disabled");
	});

	test("with the inbox slice served, the buttons wait for a draft instead of a flag", () => {
		const { client } = clientOf();
		const html = draw({ client, canPrompt: true });
		expect(html).not.toContain("waiting for the inbox slice");
		// Nothing typed yet, so nothing to send: the button is off for a reason the person controls.
		expect(html).toContain("disabled");
	});

	test("the thinking picker carries every level pi offers, so a session on max is not blank", () => {
		const { client } = clientOf();
		const html = draw({ client, canPrompt: true, thinking: "max" });
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"])
			expect(html).toContain(`>${level}</option>`);
	});

	test("the controls that the daemon serves are there", () => {
		const { client } = clientOf();
		const html = draw({ client, canPrompt: true, ask: () => undefined });
		for (const label of ["Abort", "Compact", "Stop", "Rename"]) expect(html).toContain(label);
	});

	test("rename is only there when the screen can ask for a name", () => {
		const { client } = clientOf();
		expect(draw({ client, canPrompt: true })).not.toContain("Rename");
		expect(draw({ client, canPrompt: true, ask: () => "the rig" })).toContain("Rename");
	});

	test("the mode picker never offers the full mode, which only a terminal may set", () => {
		const { client } = clientOf();
		const html = draw({ client, canPrompt: true });
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
		const html = draw({ client, canPrompt: true });
		expect(html).toContain("sent, no answer yet");
		expect(html).toContain("refused: a client cannot ask for the full mode");
	});

	test("a command that waited past the window can be sent now, or dropped", () => {
		const late: Outgoing = { id: "c1", type: "prompt.send", data: {}, at: 0, state: "waiting" };
		const recent: Outgoing = { id: "c2", type: "run.abort", data: {}, at: 0, state: "waiting" };
		const { client } = clientOf([late, recent], [late]);
		const html = draw({ client, canPrompt: true });
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
			"waiting to go",
		);
		expect(stateOf({ id: "a", type: "run.abort", data: {}, at: 0, state: "applied" })).toBe("done");
	});
});
