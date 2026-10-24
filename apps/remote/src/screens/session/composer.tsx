import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import type { CommandType, PermissionMode } from "@adeildo/pi-remote-protocol";
// The controls under the transcript: send a prompt, steer or follow up, abort, pick the model and the
// thinking, compact, rename, stop. It reads the session and the outbox from the client it is given,
// so the screen says what the queue says and never guesses.
//
// Two halves are held back on purpose: sending and draining the queue need the inbox slice to be
// served (until then the daemon refuses them), so they render disabled with the reason beside them
// instead of failing on the first click.
import { type ReactNode, createElement as h, useEffect, useState } from "react";

export interface ComposerProps {
	/** The connection this session is drawn from, which is also where commands go. */
	client: Client;
	/** Whether the daemon serves prompts and the queue yet. */
	canPrompt: boolean;
	/** The model and thinking the session is on, as the snapshot says. */
	model?: { provider: string; id: string };
	thinking?: string;
	/** Called when a control needs a value from the person, as rename does. */
	ask?: (question: string) => string | undefined;
}

/** The three modes a client may set: `full` runs everything unasked, so only a terminal may choose it. */
export const CLIENT_MODES: readonly PermissionMode[] = ["manual", "edits", "judge"];

/** pi's seven levels, in its own order: a session on `max` has to find itself in the list. */
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function Composer({ client, canPrompt, model, thinking, ask }: ComposerProps): ReactNode {
	// The queue changes without the session changing, so the composer hears the client itself.
	// Reading `outbox()` once per render makes "drawn by state" true at the mount and a lie after.
	const [, redraw] = useState(0);
	useEffect(() => client.on(() => redraw((count) => count + 1)), [client]);

	// The typed text belongs to the component, not to the document: two composers on a page, or a
	// native target with no `document`, must not share the first input it finds.
	const [draft, write] = useState("");
	const queue = client.outbox().all();
	// A command past the window waits for the person, and one inside it goes out on its own: the
	// screen has to say which, or a prompt typed offline three minutes ago looks like one in flight.
	const held = new Set(
		client
			.outbox()
			.held()
			.map((command) => command.id),
	);
	const send = (type: CommandType, data: unknown): void => {
		client.send(type, data);
	};
	return h(
		"section",
		{ className: "remote-composer" },
		promptRow(client, canPrompt, send, draft, write),
		controls(send),
		pickers(send, model, thinking),
		ask === undefined ? null : naming(send, ask),
		queueNode(queue, client, held),
	);
}

function promptRow(
	client: Client,
	canPrompt: boolean,
	send: (type: CommandType, data: unknown) => void,
	draft: string,
	write: (text: string) => void,
): ReactNode {
	const take = (deliverAs: "steer" | "followUp"): void => {
		const text = draft.trim();
		if (text === "") return;
		send("prompt.send", { text, deliverAs });
		write("");
	};
	const empty = !canPrompt || draft.trim() === "";
	return h(
		"div",
		{ className: "remote-composer-row" },
		h("input", {
			type: "text",
			name: "prompt",
			value: draft,
			placeholder: canPrompt ? "Write to the session" : "Prompts need the inbox slice",
			disabled: !canPrompt,
			"aria-label": "Prompt",
			onChange: (event: { target: { value: string } }) => write(event.target.value),
		}),
		h("button", { type: "button", disabled: empty, onClick: () => take("followUp") }, "Send"),
		h("button", { type: "button", disabled: empty, onClick: () => take("steer") }, "Steer now"),
		canPrompt
			? null
			: h("span", { className: "remote-composer-why" }, "waiting for the inbox slice"),
	);
}

function controls(send: (type: CommandType, data: unknown) => void): ReactNode {
	const button = (label: string, type: CommandType, data: unknown = {}): ReactNode =>
		h("button", { key: type, type: "button", onClick: () => send(type, data) }, label);
	return h(
		"div",
		{ className: "remote-composer-row" },
		button("Abort", "run.abort"),
		button("Compact", "session.compact"),
		button("Stop", "session.stop"),
	);
}

function pickers(
	send: (type: CommandType, data: unknown) => void,
	model: { provider: string; id: string } | undefined,
	thinking: string | undefined,
): ReactNode {
	return h(
		"div",
		{ className: "remote-composer-row" },
		h(
			"select",
			{
				name: "mode",
				"aria-label": "Permission mode",
				onChange: (event: { target: { value: string } }) => {
					const mode = CLIENT_MODES.find((one) => one === event.target.value);
					if (mode !== undefined) send("mode.set", { mode });
				},
			},
			...CLIENT_MODES.map((mode) =>
				h(
					"option",
					{ key: mode, value: mode },
					`${mode}${mode === "manual" ? " (asks first)" : ""}`,
				),
			),
		),
		h(
			"select",
			{
				name: "thinking",
				"aria-label": "Thinking",
				onChange: (event: { target: { value: string } }) =>
					send("thinking.set", { level: event.target.value }),
			},
			...THINKING.map((level) =>
				h("option", { key: level, value: level, selected: level === thinking }, level),
			),
		),
		h("span", { className: "remote-composer-model" }, model === undefined ? "" : model.id),
	);
}

function naming(
	send: (type: CommandType, data: unknown) => void,
	ask: (question: string) => string | undefined,
): ReactNode {
	return h(
		"div",
		{ className: "remote-composer-row" },
		h(
			"button",
			{
				type: "button",
				onClick: () => {
					const name = ask("Name this session");
					if (name !== undefined && name.trim() !== "")
						send("session.rename", { name: name.trim() });
				},
			},
			"Rename",
		),
	);
}

/** What the queue holds, with the reason it is still here, and a way out of the two states a
 * person can act on: a command that waited past the window goes out when they say so, or is dropped. */
function queueNode(
	queue: readonly Outgoing[],
	client: Client,
	held: ReadonlySet<string>,
): ReactNode {
	if (queue.length === 0) return null;
	return h(
		"ul",
		{ className: "remote-composer-queue" },
		...queue.map((command) =>
			h(
				"li",
				{ key: command.id, className: `remote-composer-${command.state}` },
				h("span", { className: "remote-composer-command" }, command.type),
				h(
					"span",
					{ className: "remote-composer-state" },
					command.state === "waiting" && !held.has(command.id)
						? "goes out when the daemon answers"
						: stateOf(command),
				),
				...(command.state === "waiting" && held.has(command.id)
					? [
							h(
								"button",
								{ key: "now", type: "button", onClick: () => client.outbox().release(command.id) },
								"Send now",
							),
							h(
								"button",
								{ key: "drop", type: "button", onClick: () => client.outbox().drop(command.id) },
								"Drop",
							),
						]
					: []),
			),
		),
	);
}

/** What a command's state reads as, which is what tells the person to wait, retry or give up. */
export function stateOf(command: Outgoing): string {
	switch (command.state) {
		case "waiting":
			return "waiting to go";
		case "sent":
			return "sent, no answer yet";
		case "applied":
			return "done";
		case "refused":
			return `refused: ${command.why ?? "the daemon said no"}`;
	}
}
