import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import {
	type CommandType,
	type PermissionMode,
	THINKING_LEVELS,
} from "@adeildo/pi-remote-protocol";
// The controls under the transcript: send a prompt, steer or follow up, abort, pick the model and the
// thinking, compact, rename, stop. It reads the session and the outbox from the client it is given,
// so the screen says what the queue says and never guesses.
//
// The pickers show where the session stands rather than a guess: what the snapshot says is the
// selected mode, thinking level and model, so the screen never draws the first item of a list as if
// the session were on it.
import { type ReactNode, createElement as h, useEffect, useState } from "react";

export interface ComposerProps {
	/** The connection this session is drawn from, which is also where commands go. */
	client: Client;
	/** The permission mode the session is on now, as the snapshot says. */
	mode?: PermissionMode;
	/** The model and thinking the session is on, as the snapshot says. */
	model?: { provider: string; id: string };
	thinking?: string;
	/** Called when a control needs a value from the person, as rename does. */
	ask?: (question: string) => string | undefined;
}

/** The three modes a client may set: `full` runs everything unasked, so only a terminal may choose it. */
export const CLIENT_MODES: readonly PermissionMode[] = ["manual", "edits", "judge"];

export function Composer({ client, mode, model, thinking, ask }: ComposerProps): ReactNode {
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
		promptRow(send, draft, write),
		controls(send),
		pickers(send, mode, model, thinking),
		ask === undefined ? null : naming(send, ask),
		queueNode(queue, client, held),
	);
}

/**
 * Whether a key press is "send this draft". Enter is, Shift+Enter is not: the second is how a person
 * writes a second line in a one-line field that some hosts give them, and swallowing it loses the line.
 */
export function enterSends(
	event: { key: string; shiftKey?: boolean; preventDefault?: () => void },
	take: () => void,
): boolean {
	if (event.key !== "Enter" || event.shiftKey === true) return false;
	event.preventDefault?.();
	take();
	return true;
}

function promptRow(
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
	const empty = draft.trim() === "";
	return h(
		"div",
		{ className: "remote-composer-row" },
		promptInput({
			draft,
			empty,
			write,
			take: (deliverAs) => take(deliverAs),
		}),
		h("button", { type: "button", disabled: empty, onClick: () => take("followUp") }, "Send"),
		h("button", { type: "button", disabled: empty, onClick: () => take("steer") }, "Steer now"),
	);
}

/** What the prompt field needs: the draft, what to do with it, and how to know it is empty. */
export interface PromptInput {
	draft: string;
	empty: boolean;
	write: (text: string) => void;
	take: (deliverAs: "steer" | "followUp") => void;
}

/**
 * The prompt field, apart from the row that holds it, so a test can read the `onKeyDown` it carries.
 * The wiring is the half that gets lost: the helper below can be perfect and the field never call it.
 */
export function promptInput(props: PromptInput): ReactNode {
	return h("input", {
		type: "text",
		name: "prompt",
		value: props.draft,
		placeholder: "Write to the session",
		"aria-label": "Prompt",
		onChange: (event: { target: { value: string } }) => props.write(event.target.value),
		// Enter sends, which is what a phone keyboard and every chat field do. Without it the field takes
		// the text and the person has to find the button, and a keyboard-only reader keeps the draft.
		onKeyDown: (event: { key: string; shiftKey?: boolean; preventDefault: () => void }) => {
			enterSends(event, () => props.take("followUp"));
		},
	});
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
	mode: PermissionMode | undefined,
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
				// Without a value React draws the first option, which would say "manual" for a session
				// that is in `judge`: the snapshot's mode is what the select starts on.
				value: mode ?? "manual",
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
				// Controlled, like the mode: `selected` on an option is what React warns about, and a
				// picker that ignores its prop looks the same as one that honours it.
				value: thinking ?? "off",
				onChange: (event: { target: { value: string } }) =>
					send("thinking.set", { level: event.target.value }),
			},
			...THINKING_LEVELS.map((level) => h("option", { key: level, value: level }, level)),
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
								{ key: "now", type: "button", onClick: () => sendNow(client, command.id) },
								"Send now",
							),
							h(
								"button",
								{ key: "drop", type: "button", onClick: () => dropNow(client, command.id) },
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
			// A waiting command reaches this function only when it waited past the window: one inside
			// it is said as "goes out when the daemon answers" by the caller.
			return "waiting for you";
		case "sent":
			return "sent, no answer yet";
		case "applied":
			return "done";
		case "refused":
			return `refused: ${command.why ?? "the daemon said no"}`;
	}
}

/** Sends a held command now: it keeps its id, so the far side still reads it as the same one. */
export function sendNow(client: Client, id: string): void {
	client.release(id);
}

/** Gives up on a held command: it leaves the queue and nothing goes out. */
export function dropNow(client: Client, id: string): void {
	client.drop(id);
}
