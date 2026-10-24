import { describe, expect, test } from "bun:test";

import { envelope } from "@adeildo/pi-remote-protocol";

import { envelopeOf, line, Lines } from "../src/wire/lines.ts";

describe("one envelope per line", () => {
	test("a line cut across chunks comes out whole once its LF arrives", () => {
		const lines = new Lines();
		expect(lines.push('{"a":')).toEqual([]);
		expect(lines.push('1}\n{"b"')).toEqual(['{"a":1}']);
		expect(lines.push(":2}\n\n")).toEqual(['{"b":2}', ""]);
	});

	test("only LF ends a line, and JSON reads past the CR it leaves", () => {
		const lines = new Lines();
		const [text] = lines.push(`${JSON.stringify(envelope("event", "x", "a\r\nb"))}\r\n`);
		expect(text?.endsWith("\r")).toBe(true);
		expect(envelopeOf(text ?? "")?.data).toBe("a\r\nb");
	});

	test("a line past the bound is dropped up to its LF, once, and the next one comes out", () => {
		let oversize = 0;
		const lines = new Lines(() => {
			oversize += 1;
		}, 8);
		expect(lines.push("123456")).toEqual([]);
		expect(lines.push("789")).toEqual([]);
		expect(lines.push("abc")).toEqual([]);
		expect(lines.push("def\nok\n")).toEqual(["ok"]);
		expect(oversize).toBe(1);
	});

	test("a whole line past the bound is dropped too, whether its LF comes in its chunk or a later one", () => {
		let oversize = 0;
		const lines = new Lines(() => {
			oversize += 1;
		}, 1_024);
		expect(lines.push(`${"x".repeat(5_000)}\nok\n`)).toEqual(["ok"]);
		expect(lines.push("y".repeat(600))).toEqual([]);
		expect(lines.push(`${"z".repeat(600)}\nnext\n`)).toEqual(["next"]);
		expect(oversize).toBe(2);
	});

	test("a line exactly at the bound still comes out", () => {
		const lines = new Lines(() => {
			throw new Error("not oversize");
		}, 8);
		expect(lines.push("1234")).toEqual([]);
		expect(lines.push("5678\n")).toEqual(["12345678"]);
	});

	test("what a line says is read back, and what is not an envelope of this version is not", () => {
		const sent = envelope("event", "tasks.changed", { state: {} }, { session: "s1", seq: 3 });
		expect(envelopeOf(line(sent).trimEnd())).toEqual(sent);
		expect(envelopeOf("not json")).toBeUndefined();
		expect(envelopeOf('{"type":"x"}')).toBeUndefined();
		expect(envelopeOf(JSON.stringify({ ...sent, v: 2 }))).toBeUndefined();
	});
});
