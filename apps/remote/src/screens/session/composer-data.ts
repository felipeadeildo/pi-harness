// What the composer decides, apart from the views that show it: a phone draws with views, and a test
// cannot load them. The rules stay here, and the screen only wires them.
import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import {
	type CommandMap,
	type CommandType,
	type ModelOption,
	type PermissionMode,
	THINKING_LEVELS,
} from "@adeildo/pi-remote-protocol";

/** The three modes a client may set: `full` runs everything unasked, so only a terminal may choose it. */
export const CLIENT_MODES: readonly PermissionMode[] = ["manual", "edits", "judge"];

const MODE_HINT: Partial<Record<PermissionMode, string>> = {
	manual: "asks before every action",
	edits: "runs edits without asking",
	judge: "a judge decides what runs",
};

/** One value of a picker, ready to draw and to read in a test. */
export interface Choice<T extends string> {
	value: T;
	hint?: string;
	chosen: boolean;
}

/**
 * The modes the dial offers, with the session's own on. Serving the mode is a capability and having a
 * value is state: a session that says it takes none gets no dial, because one that can only be refused
 * is worse than none, and one that has not said yet gets the dial, so it does not blink in.
 */
export function modeChoices(
	mode: PermissionMode | undefined,
	serves: boolean | undefined,
): Choice<PermissionMode>[] {
	if (serves === false) return [];
	return CLIENT_MODES.map((value) => ({
		value,
		hint: MODE_HINT[value],
		// Without a mode the session has not said which it is on, and the first is the one pi starts in.
		chosen: value === (mode ?? "manual"),
	}));
}

/** Every thinking level pi offers, with the session's on, so a session on `max` is not drawn blank. */
export function levelChoices(thinking: string | undefined): Choice<string>[] {
	return THINKING_LEVELS.map((value) => ({ value, chosen: value === (thinking ?? "off") }));
}

/**
 * What the one filled button does. Typing always sends. With nothing typed it is a dead button, except
 * during a run, where it becomes Abort in the same place: the button keeps its footprint and the field
 * does not move when a run starts.
 */
export function primaryAct(running: boolean, empty: boolean): "send" | "abort" {
	return running && empty ? "abort" : "send";
}

/** An act the overflow menu offers, and whether it can run now. */
export interface MenuItem {
	id: "steer" | "abort" | "compact" | "rename" | "stop";
	label: string;
	enabled: boolean;
}

/**
 * The acts behind the overflow control. Each is there always and enabled when it can mean something, so
 * the menu has the same rows every time it opens: steering needs text and a run, aborting needs a run,
 * and renaming needs a screen that can ask for a name.
 */
export function menuItems(state: {
	running: boolean;
	empty: boolean;
	canRename: boolean;
}): MenuItem[] {
	const items: MenuItem[] = [
		{ id: "steer", label: "Steer now", enabled: state.running && !state.empty },
		{ id: "abort", label: "Abort the run", enabled: state.running },
		{ id: "compact", label: "Compact", enabled: true },
	];
	if (state.canRename) items.push({ id: "rename", label: "Rename", enabled: true });
	items.push({ id: "stop", label: "Stop the session", enabled: true });
	return items;
}

/**
 * The model the session is on, as the one line the picker shows. Before the session has said which one,
 * the line is empty and the chip shows its own name: "no model" would say there is none.
 */
export function modelLabel(model: { provider: string; id: string } | undefined): string {
	return model === undefined ? "" : model.id;
}

/**
 * What the sheet says when the list it holds is shorter than the registry's: the search covers only
 * those, and a list cut without a word reads as the whole registry.
 */
export function modelsNote(held: number, total: number | undefined): string | undefined {
	return total !== undefined && total > held
		? `${held} of ${total} models, refine the search`
		: undefined;
}

/** Sends a held command now: it keeps its id, so the far side reads it as the same one. */
export function sendNow(client: Client, id: string): void {
	client.release(id);
}

/** Gives up on a held command: it leaves the queue and nothing goes out. */
export function dropNow(client: Client, id: string): void {
	client.drop(id);
}

/** What a command's state says to the person: to wait, to retry, or that it is done. */
export function stateOf(command: Outgoing): string {
	switch (command.state) {
		case "waiting":
			// Only a command that waited past the window reaches here: one inside it is said as
			// "goes out when the daemon answers" by the caller.
			return "waiting for you";
		case "sent":
			return "sent, no answer yet";
		case "applied":
			return "done";
		case "refused":
			return `refused: ${command.why ?? "the daemon said no"}`;
	}
}

/**
 * What the outbox says of one command, and whether the person can act on it. Only a command that
 * waited past the window is theirs to send or drop: one inside it goes out on its own, and the line
 * has to say which, or a prompt typed offline three minutes ago looks like one in flight.
 */
export function outboxLine(
	command: Outgoing,
	heldIds: ReadonlySet<string>,
): { text: string; actionable: boolean } {
	const waiting = command.state === "waiting";
	if (waiting && !heldIds.has(command.id))
		return { text: "goes out when the daemon answers", actionable: false };
	return { text: stateOf(command), actionable: waiting };
}

/** Sends the draft and clears it, which is what both the button and Enter do. */
export function takeDraft(
	send: <K extends CommandType>(type: K, data: CommandMap[K]) => void,
	draft: string,
	clear: () => void,
	deliverAs: "steer" | "followUp",
): void {
	const text = draft.trim();
	if (text === "") return;
	send("prompt.send", { text, deliverAs });
	clear();
}

/**
 * The models a search leaves. Every word typed has to be in the name, the id or the provider, in any
 * order and whatever the case, so "opus anth" finds Anthropic's Opus. Nothing typed leaves the whole
 * list, in the order the session gave it: the screen does not rank.
 */
export function matchModels(models: readonly ModelOption[], query: string): ModelOption[] {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word !== "");
	return models.filter((model) => {
		const haystack = `${model.name} ${model.id} ${model.provider}`.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}

/** Whether a listed model is the one the session is on. */
export function isCurrentModel(
	model: ModelOption,
	current: { provider: string; id: string } | undefined,
): boolean {
	return current !== undefined && model.provider === current.provider && model.id === current.id;
}
