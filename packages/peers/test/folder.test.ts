import { expect, test } from "bun:test";

import { Folder, KEEP_MESSAGES } from "../src/folder.ts";

function posted(index: number) {
	return {
		v: 1,
		id: `e${index}`,
		at: index,
		session: "a",
		type: "message.posted",
		data: { id: `m${index}`, from: "you", to: "all", text: `hello ${index}` },
	} as never;
}

function read(index: number) {
	return {
		v: 1,
		id: `r${index}`,
		at: index,
		session: "b",
		type: "message.read",
		data: { id: `m${index}` },
	} as never;
}

test("a flooded room keeps only its newest messages, and a line about a forgotten one is skipped", () => {
	const folder = new Folder();
	const flood = Array.from({ length: KEEP_MESSAGES * 3 }, (_, index) => posted(index));
	folder.apply(flood);
	expect(folder.messages.size).toBe(KEEP_MESSAGES);
	expect(folder.messages.has("m0")).toBe(false);
	expect(folder.messages.has(`m${KEEP_MESSAGES * 3 - 1}`)).toBe(true);
	expect(folder.room.length).toBeLessThan(flood.length);
	folder.apply([read(0), read(KEEP_MESSAGES * 3 - 1)]);
	expect(folder.messages.get(`m${KEEP_MESSAGES * 3 - 1}`)?.read.has("b")).toBe(true);
});
