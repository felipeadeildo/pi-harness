import { expect, test } from "bun:test";

import { renderLine, renderLines, SEPARATORS } from "../src/line.ts";

const options = { separators: SEPARATORS.bar, cutOrder: ["first", "second"] };

// oxlint-disable-next-line no-control-regex -- dropping the escape codes is the point
const plain = (text: string | undefined) => text?.replace(/\u001b\[[0-9;]*m/g, "");
const group = (id: string, parts: (string | undefined)[]) => ({ id, parts });

test("pieces in a group are joined by the item separator and groups by the group separator", () => {
	expect(renderLine([group("first", ["a", "b"]), group("second", ["c"])], 80, options)).toBe(
		"a · b │ c",
	);
});

test("a group with nothing to say is left out, separator and all", () => {
	expect(renderLine([group("first", [undefined]), group("second", ["c"])], 80, options)).toBe("c");
	expect(renderLine([group("first", []), group("second", ["c"])], 80, options)).toBe("c");
});

test("nothing to show means no line at all", () => {
	expect(renderLine([group("first", [undefined])], 80, options)).toBeUndefined();
});

test("when the width runs out the groups leave in the given order", () => {
	const groups = [group("first", ["aaaa"]), group("second", ["bbbb"])];
	expect(renderLine(groups, 80, options)).toBe("aaaa │ bbbb");
	expect(renderLine(groups, 9, options)).toBe("bbbb");
});

test("the last group stays and is cut, so the line is never empty", () => {
	expect(plain(renderLine([group("first", ["aaaa"]), group("second", ["bbbb"])], 3, options))).toBe(
		"bb…",
	);
	expect(plain(renderLine([group("first", ["aaaa"])], 2, options))).toBe("a…");
});

test("a group that is not in the cut order stays", () => {
	const groups = [group("permanent", ["keep me"]), group("first", ["drop me"])];
	const cut = { separators: SEPARATORS.dot, cutOrder: ["first"] };
	expect(renderLine(groups, 8, cut)).toBe("keep me");
});

test("separators can be painted, and the width counts the painted text", () => {
	const painted = { ...options, dim: (text: string) => `<${text}>` };
	expect(renderLine([group("first", ["a", "b"])], 80, painted)).toBe("a <·> b");
});

test("only lines with something to say are returned", () => {
	const lines = [
		[group("first", ["one"])],
		[group("first", [undefined])],
		[group("first", ["two"])],
	];
	expect(renderLines(lines, 80, options)).toEqual(["one", "two"]);
});
