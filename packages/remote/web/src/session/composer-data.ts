import {
	type CommandMap,
	type CommandType,
	type ModelOption,
	type PermissionMode,
	THINKING_LEVELS,
} from "@adeildo/pi-remote-protocol";
// What the composer decides, apart from the views, so a test can read it.
import type { Client, Outgoing } from "@adeildo/pi-remote-protocol/client";

/** `full` runs everything unasked, so only a terminal may choose it. */
export const CLIENT_MODES: readonly PermissionMode[] = ["manual", "edits", "judge"];

const MODE_HINT: Partial<Record<PermissionMode, string>> = {
	manual: "asks before every action",
	edits: "runs edits without asking",
	judge: "a judge decides what runs",
};

export interface Choice<T extends string> {
	value: T;
	hint?: string;
	chosen: boolean;
}

/** No dial for a session that takes no mode; one that has not said yet gets it, so it does not blink in. */
export function modeChoices(
	mode: PermissionMode | undefined,
	serves: boolean | undefined,
): Choice<PermissionMode>[] {
	if (serves === false) return [];
	return CLIENT_MODES.map((value) => ({
		value,
		hint: MODE_HINT[value],
		// Without a mode the session has not said; pi starts in the first.
		chosen: value === (mode ?? "manual"),
	}));
}

/** Includes the session's level, so `max` is not drawn blank. */
export function levelChoices(thinking: string | undefined): Choice<string>[] {
	return THINKING_LEVELS.map((value) => ({ value, chosen: value === (thinking ?? "off") }));
}

/** With nothing typed during a run, the button becomes Abort in the same place. */
export function primaryAct(running: boolean, empty: boolean): "send" | "abort" {
	return running && empty ? "abort" : "send";
}

export interface MenuItem {
	id: "steer" | "abort" | "compact" | "rename" | "stop";
	label: string;
	enabled: boolean;
}

/** Every item is always listed, enabled when it can mean something, so the menu never changes shape. */
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

/** Empty until the session says, since "no model" would claim there is none. */
export function modelLabel(model: { provider: string; id: string } | undefined): string {
	return model === undefined ? "" : model.id;
}

export function modelsNote(held: number, total: number | undefined): string | undefined {
	return total !== undefined && total > held
		? `${held} of ${total} models, refine the search`
		: undefined;
}

export function sendNow(client: Client, id: string): void {
	client.release(id);
}

export function dropNow(client: Client, id: string): void {
	client.drop(id);
}

export function stateOf(command: Outgoing): string {
	switch (command.state) {
		case "waiting":
			// Only a command past the window reaches here.
			return "waiting for you";
		case "sent":
			return "sent, no answer yet";
		case "applied":
			return "done";
		case "refused":
			return `refused: ${command.why ?? "the daemon said no"}`;
	}
}

/** Only a command past the window is the person's to send or drop. */
export function outboxLine(
	command: Outgoing,
	heldIds: ReadonlySet<string>,
): { text: string; actionable: boolean } {
	const waiting = command.state === "waiting";
	if (waiting && !heldIds.has(command.id))
		return { text: "goes out when the daemon answers", actionable: false };
	return { text: stateOf(command), actionable: waiting };
}

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

/** Every word typed must be in the name, id or provider, in any order and case. */
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

export function isCurrentModel(
	model: ModelOption,
	current: { provider: string; id: string } | undefined,
): boolean {
	return current !== undefined && model.provider === current.provider && model.id === current.id;
}
