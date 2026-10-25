import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import {
	type CommandMap,
	type CommandType,
	type PermissionMode,
	type QueuedMessage,
	type SessionCommand,
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

import { dropNow, enterSends, sendNow, stateOf, takeDraft } from "./composer-data.ts";
import { queuedLines, type QueuedLine, withdraw } from "./pending.ts";
import { chosen, suggested, type Suggestion } from "./suggestions.ts";

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
	/** What the session is holding for the agent to finish, which every client sees the same way. */
	waiting?: readonly QueuedMessage[];
	/** What a phone may run by typing `/`, as the session last said. Nothing here, nothing offered. */
	commands?: SessionCommand[];
	/** Whether the session takes `mode.set`. A dial that can only be refused is worse than none. */
	serves?: boolean;
	/**
	 * What the field starts with. A draft restored from the cache and a test both need the field to open
	 * with text already in it, which is why it is a prop and not a fixture inside the component.
	 */
	initialDraft?: string;
}

/** The three modes a client may set: `full` runs everything unasked, so only a terminal may choose it. */
export const CLIENT_MODES: readonly PermissionMode[] = ["manual", "edits", "judge"];

export function Composer({
	client,
	mode,
	model,
	thinking,
	ask,
	waiting,
	commands,
	serves,
	initialDraft,
}: ComposerProps): ReactNode {
	// The queue changes without the session changing, so the composer hears the client itself.
	// Reading `outbox()` once per render makes "drawn by state" true at the mount and a lie after.
	const [, redraw] = useState(0);
	useEffect(() => client.on(() => redraw((count) => count + 1)), [client]);

	// The typed text belongs to the component, not to the document: two composers on a page, or a
	// native target with no `document`, must not share the first input it finds.
	const [draft, write] = useState(initialDraft ?? "");
	const queue = client.outbox().all();
	// The session's own queue is drawn beside the outbox and never merged with it: what this device
	// sent and what the session holds are different lists, and each has its own act.
	const queued = queuedLines(waiting ?? []);
	// The suggestions come from the session, not from a list in the app: what is offered here is what
	// the bridge will accept, and a command that appears later stays absent until the session says so.
	const offering = suggested(draft, commands ?? []);
	// A command past the window waits for the person, and one inside it goes out on its own: the
	// screen has to say which, or a prompt typed offline three minutes ago looks like one in flight.
	const held = new Set(
		client
			.outbox()
			.held()
			.map((command) => command.id),
	);
	// Typed by the command, like `Client.send`: a payload that does not match the command it names is a
	// compile error here instead of a refusal from the daemon.
	const send = <K extends CommandType>(type: K, data: CommandMap[K]): void => {
		client.send(type, data);
	};
	return h(
		"section",
		{ className: "remote-composer" },
		promptRow(send, draft, write, offering),
		controls(send),
		pickers(send, mode, serves, model, thinking),
		ask === undefined ? null : naming(send, ask),
		queueNode(queue, client, held),
		heldNode(queued, client),
	);
}

function promptRow(
	send: <K extends CommandType>(type: K, data: CommandMap[K]) => void,
	draft: string,
	write: (text: string) => void,
	offering: readonly Suggestion[],
): ReactNode {
	const take = (deliverAs: "steer" | "followUp"): void =>
		takeDraft(send, draft, () => write(""), deliverAs);
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
		suggestionList(offering, write),
	);
}

/**
 * What `/` offers: the session's own list, filtered by what was typed. Choosing one writes the command
 * and keeps the cursor in the field, because the instruction beside it is what the person still types.
 */
export function suggestionList(
	offering: readonly Suggestion[],
	write: (text: string) => void,
): ReactNode {
	if (offering.length === 0) return null;
	return h(
		"ul",
		{ className: "remote-composer-suggestions" },
		...offering.map((one) =>
			h(
				"li",
				{ key: one.name },
				h(
					"button",
					{ type: "button", onClick: () => write(chosen(one.name)) },
					h("span", { className: "remote-composer-command" }, one.name),
					one.description === undefined
						? null
						: h("span", { className: "remote-composer-hint" }, one.description),
				),
			),
		),
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

function controls(send: <K extends CommandType>(type: K, data: CommandMap[K]) => void): ReactNode {
	const button = <K extends CommandType>(label: string, type: K, data: CommandMap[K]): ReactNode =>
		h("button", { key: type, type: "button", onClick: () => send(type, data) }, label);
	return h(
		"div",
		{ className: "remote-composer-row" },
		button("Abort", "run.abort", {}),
		button("Compact", "session.compact", {}),
		button("Stop", "session.stop", {}),
	);
}

function pickers(
	send: <K extends CommandType>(type: K, data: CommandMap[K]) => void,
	mode: PermissionMode | undefined,
	serves: boolean | undefined,
	model: { provider: string; id: string } | undefined,
	thinking: string | undefined,
): ReactNode {
	const dial =
		serves === false
			? null
			: h(
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
				);
	return h(
		"div",
		{ className: "remote-composer-row" },
		dial,
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
	send: <K extends CommandType>(type: K, data: CommandMap[K]) => void,
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

/** Sends a held command now: it keeps its id, so the far side still reads it as the same one. */

/** Gives up on a held command: it leaves the queue and nothing goes out. */

/**
 * The session's queue, in the order it will run, with the act that takes a message back. It says
 * "waiting its turn" and not "sending", because this list belongs to the session, not to the device:
 * two phones see the same lines, and neither of them can make one go faster.
 */
function heldNode(lines: readonly QueuedLine[], client: Client): ReactNode {
	if (lines.length === 0) return null;
	return h(
		"ul",
		{ className: "remote-composer-held" },
		...lines.map((line) =>
			h(
				"li",
				{ key: line.id, className: "remote-composer-waiting" },
				h("span", { className: "remote-composer-text" }, line.text),
				h("span", { className: "remote-composer-by" }, line.by),
				h(
					"button",
					{ key: "withdraw", type: "button", onClick: () => withdraw(client, line.id) },
					"Withdraw",
				),
			),
		),
	);
}
