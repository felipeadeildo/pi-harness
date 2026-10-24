// The controls say what the queue says. A test here is about what a person reads and what a click
// sends, not about the daemon, so the client is a stand-in that records.
import { describe, expect, test } from "bun:test";

import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import type { CommandType } from "@adeildo/pi-remote-protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CLIENT_MODES, Composer, stateOf } from "./composer.tsx";

function clientOf(queue: Outgoing[] = []): { client: Client; sent: [CommandType, unknown][] } {
	const sent: [CommandType, unknown][] = [];
	const client = {
		send: (type: CommandType, data: unknown) => {
			sent.push([type, data]);
			return { id: "c1", type, data, at: 0, state: "waiting" as const };
		},
		outbox: () => ({ all: () => queue }),
	} as unknown as Client;
	return { client, sent };
}

const draw = (props: Parameters<typeof Composer>[0]): string =>
	renderToStaticMarkup(createElement(Composer, props));

describe("the composer", () => {
	test("the prompt is disabled with the reason, until the inbox slice is served", () => {
		const { client } = clientOf();
		const html = draw({ client, canPrompt: false });
		expect(html).toContain("Prompts arrive with the inbox slice");
		expect(html).toContain("waiting for the inbox slice");
		expect(html).toContain("disabled");
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

	test("a state reads as what the person does about it", () => {
		expect(stateOf({ id: "a", type: "run.abort", data: {}, at: 0, state: "waiting" })).toBe(
			"waiting to go",
		);
		expect(stateOf({ id: "a", type: "run.abort", data: {}, at: 0, state: "applied" })).toBe("done");
	});
});
