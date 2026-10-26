// What the composer decides, with no screen: a phone draws with views and a test cannot load them, so
// every rule the views wire is read here from the module that owns it.
import { describe, expect, test } from "bun:test";

import type { CommandType } from "@adeildo/pi-remote-protocol";
import type { Client, Outgoing } from "@adeildo/pi-remote-protocol/client";

import {
	CLIENT_MODES,
	dropNow,
	isCurrentModel,
	levelChoices,
	matchModels,
	modeChoices,
	menuItems,
	modelLabel,
	modelsNote,
	outboxLine,
	primaryAct,
	sendNow,
	stateOf,
	takeDraft,
} from "./composer-data.ts";

const command = (state: Outgoing["state"], over: Partial<Outgoing> = {}): Outgoing => ({
	id: "a",
	type: "run.abort",
	data: {},
	at: 0,
	state,
	...over,
});

describe("the pickers", () => {
	test("the mode dial offers the three modes a client may set, never the full one", () => {
		expect(CLIENT_MODES).toEqual(["manual", "edits", "judge"]);
		expect(modeChoices("edits", true).map((one) => one.value)).toEqual(CLIENT_MODES);
	});

	test("the mode dial starts on the mode the session is in", () => {
		const chosen = (mode: Parameters<typeof modeChoices>[0]) =>
			modeChoices(mode, true).find((one) => one.chosen)?.value;
		expect(chosen("judge")).toBe("judge");
		expect(chosen("edits")).toBe("edits");
		// A session that has not said its mode is on the one pi starts in, and exactly one is chosen.
		expect(chosen(undefined)).toBe("manual");
		expect(modeChoices("judge", true).filter((one) => one.chosen)).toHaveLength(1);
	});

	test("every mode says what it does, so a chip is never a bare word", () => {
		for (const one of modeChoices("manual", true)) expect(one.hint).toBeString();
	});

	test("the dial is absent when the session says it takes no mode, and there when it has not said", () => {
		// Serving the mode is a capability, having a value is state. A dial that can only be refused is
		// worse than none, and "not said yet" is not "no": the dial waits instead of blinking.
		expect(modeChoices("edits", true)).not.toHaveLength(0);
		expect(modeChoices(undefined, false)).toEqual([]);
		expect(modeChoices(undefined, undefined)).not.toHaveLength(0);
	});

	test("the thinking picker carries every level pi offers, so a session on max is not blank", () => {
		const levels = levelChoices("max");
		expect(levels.map((one) => one.value)).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
		expect(levels.find((one) => one.chosen)?.value).toBe("max");
		expect(levelChoices(undefined).find((one) => one.chosen)?.value).toBe("off");
	});

	test("the model line names the model, and says so when there is none", () => {
		expect(modelLabel({ provider: "anthropic", id: "opus" })).toBe("opus");
		// Not said yet is not "no model": the chip shows its own name until the session says which.
		expect(modelLabel(undefined)).toBe("");
	});
});

describe("the outbox", () => {
	test("each state reads as what the person does about it", () => {
		expect(stateOf(command("waiting"))).toBe("waiting for you");
		expect(stateOf(command("sent"))).toBe("sent, no answer yet");
		expect(stateOf(command("applied"))).toBe("done");
		expect(stateOf(command("refused", { why: "a client cannot ask for the full mode" }))).toBe(
			"refused: a client cannot ask for the full mode",
		);
	});

	test("a command that waited past the window can be sent or dropped, and one inside it cannot", () => {
		const late = command("waiting", { id: "late" });
		const recent = command("waiting", { id: "recent" });
		const held = new Set(["late"]);
		expect(outboxLine(late, held)).toEqual({ text: "waiting for you", actionable: true });
		expect(outboxLine(recent, held)).toEqual({
			text: "goes out when the daemon answers",
			actionable: false,
		});
		// A command already out has nothing left to decide.
		expect(outboxLine(command("sent", { id: "late" }), held).actionable).toBe(false);
	});

	test("each act does its own thing, which the label cannot prove", () => {
		const calls: string[] = [];
		const client = {
			release: (id: string) => void calls.push(`release ${id}`),
			drop: (id: string) => void calls.push(`drop ${id}`),
		} as unknown as Client;
		sendNow(client, "c1");
		dropNow(client, "c2");
		expect(calls).toEqual(["release c1", "drop c2"]);
	});
});

describe("the draft", () => {
	const sent: [CommandType, unknown][] = [];
	const send = (type: CommandType, data: unknown) => void sent.push([type, data]);

	test("sending takes the text trimmed, names how it is delivered and clears the field", () => {
		sent.length = 0;
		let cleared = 0;
		takeDraft(send, "  ship it  ", () => (cleared += 1), "steer");
		expect(sent).toEqual([["prompt.send", { text: "ship it", deliverAs: "steer" }]]);
		expect(cleared).toBe(1);
	});

	test("an empty draft sends nothing and keeps the field", () => {
		sent.length = 0;
		let cleared = 0;
		takeDraft(send, "   ", () => (cleared += 1), "followUp");
		expect(sent).toEqual([]);
		expect(cleared).toBe(0);
	});
});

describe("the field's row", () => {
	test("the one filled button sends, and becomes Abort only for a run with nothing typed", () => {
		expect(primaryAct(false, true)).toBe("send");
		expect(primaryAct(false, false)).toBe("send");
		expect(primaryAct(true, false)).toBe("send");
		expect(primaryAct(true, true)).toBe("abort");
	});

	test("the overflow menu has the same rows every time, enabled when they can mean something", () => {
		const idle = menuItems({ running: false, empty: true, canRename: true });
		const going = menuItems({ running: true, empty: false, canRename: true });
		expect(idle.map((one) => one.id)).toEqual(going.map((one) => one.id));
		const enabled = (rows: typeof idle) => rows.filter((one) => one.enabled).map((one) => one.id);
		expect(enabled(idle)).toEqual(["compact", "rename", "stop"]);
		expect(enabled(going)).toEqual(["steer", "abort", "compact", "rename", "stop"]);
	});

	test("steering needs both a run and text, and renaming needs a screen that can ask", () => {
		const only = (running: boolean, empty: boolean) =>
			menuItems({ running, empty, canRename: false }).find((one) => one.id === "steer")?.enabled;
		expect(only(true, true)).toBe(false);
		expect(only(false, false)).toBe(false);
		expect(only(true, false)).toBe(true);
		expect(
			menuItems({ running: false, empty: true, canRename: false }).map((one) => one.id),
		).not.toContain("rename");
	});
});

describe("the model sheet", () => {
	const models = [
		{ provider: "anthropic", id: "claude-opus", name: "Opus" },
		{ provider: "anthropic", id: "claude-haiku", name: "Haiku" },
		{ provider: "openai", id: "gpt-opus-like", name: "GPT Large" },
	];

	test("nothing typed leaves the whole list, in the order the session gave it", () => {
		expect(matchModels(models, "").map((one) => one.id)).toEqual([
			"claude-opus",
			"claude-haiku",
			"gpt-opus-like",
		]);
		expect(matchModels(models, "   ")).toHaveLength(3);
	});

	test("a word is found in the name, the id or the provider, whatever the case", () => {
		expect(matchModels(models, "HAIKU").map((one) => one.id)).toEqual(["claude-haiku"]);
		expect(matchModels(models, "openai").map((one) => one.id)).toEqual(["gpt-opus-like"]);
		// "opus" is in a name and in the id of another provider's model, and both are listed.
		expect(matchModels(models, "opus").map((one) => one.id)).toEqual([
			"claude-opus",
			"gpt-opus-like",
		]);
	});

	test("every word has to match, in any order", () => {
		expect(matchModels(models, "opus anthropic").map((one) => one.id)).toEqual(["claude-opus"]);
		expect(matchModels(models, "anthropic opus").map((one) => one.id)).toEqual(["claude-opus"]);
		expect(matchModels(models, "opus nothing")).toEqual([]);
	});

	test("the model the session is on is told by provider and id together, not by id alone", () => {
		const current = { provider: "anthropic", id: "claude-opus" };
		expect(models.map((one) => isCurrentModel(one, current))).toEqual([true, false, false]);
		// The same id under another provider is another model.
		expect(isCurrentModel({ provider: "other", id: "claude-opus", name: "Opus" }, current)).toBe(
			false,
		);
		expect(models.map((one) => isCurrentModel(one, undefined))).toEqual([false, false, false]);
	});
});

describe("when the list is shorter than the registry", () => {
	test("the sheet says how many it holds of how many, and says nothing when it holds them all", () => {
		expect(modelsNote(300, 301)).toBe("300 of 301 models, refine the search");
		expect(modelsNote(300, 300)).toBeUndefined();
		// A list nobody counted is not a short one.
		expect(modelsNote(300, undefined)).toBeUndefined();
	});
});
