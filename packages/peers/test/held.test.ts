import { expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { heldBlock, isWentIn } from "../src/ui/held.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const item = {
	id: "m1",
	from: "api",
	color: "accent",
	fromYou: false,
	toYou: false,
	everyone: true,
	text: "/v1/fleet now has a capacity field.",
	at: 0,
};

function drawn(...args: Parameters<typeof heldBlock>): string {
	return heldBlock(...args)
		.render(200)
		.map((line) => stripTerminalSequences(line))
		.join("\n");
}

test("a held message is drawn with the reason it waits under it", () => {
	const lines = drawn({ items: [item], why: "quiet", chain: 12 }, plain).split("\n");
	expect(lines.join("\n")).toContain("/v1/fleet now has a capacity field.");
	expect(lines.at(-1)?.trim()).toBe(
		"It waits for your next prompt: the agents answered each other 12 times without you, which looks like a loop.",
	);
});

test("once a run that was not yours takes it, the line says which", () => {
	const block = { items: [item], why: "quiet" as const };
	const taken = new Map<string, { by?: string }>();
	expect(drawn(block, plain, (id) => taken.get(id))).toContain("It waits for your next prompt");
	taken.set("m1", { by: "otter" });
	expect(drawn(block, plain, (id) => taken.get(id))).toContain(
		"It went in with the next run, which @otter's message started.",
	);
	expect(drawn(block, plain, () => ({}))).toContain(
		"It went in with the next run, which you did not start.",
	);
});

test("once you let it through from Alt+G, the line says so", () => {
	const block = { items: [item], why: "quiet" as const };
	expect(drawn(block, plain, () => ({ released: true }))).toContain(
		"It went in when you let it through.",
	);
});

test("a message you stopped the run before it was read says so", () => {
	const lines = heldBlock({ items: [item], why: "stopped" }, plain)
		.render(100)
		.map((line) => stripTerminalSequences(line));
	expect(lines.at(-1)?.trim()).toBe(
		"It waits for your next prompt: you stopped the run before the agent read it.",
	);
});

test("what a session keeps of a run that took held messages is read back only when it is whole", () => {
	expect(isWentIn({ ids: ["m1"], by: "otter" })).toBe(true);
	expect(isWentIn({ ids: ["m1"] })).toBe(true);
	expect(isWentIn({ ids: ["m1"], released: true })).toBe(true);
	expect(isWentIn({ ids: ["m1"], released: "yes" })).toBe(false);
	expect(isWentIn({ ids: [1] })).toBe(false);
	expect(isWentIn({ ids: ["m1"], by: 2 })).toBe(false);
	expect(isWentIn({ by: "otter" })).toBe(false);
});
