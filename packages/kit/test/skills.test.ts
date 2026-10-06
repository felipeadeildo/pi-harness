import { expect, test } from "bun:test";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import {
	addSkillNames,
	drawSkillRefs,
	referencedSkills,
	SKILL_NAMES,
	skillNames,
} from "../src/contracts/skills.ts";

const NAMES = ["simplify", "unslop", "ce-simplify-code"];

test("a reference counts anywhere in the text, once per skill, in order", () => {
	const text = "use /skill:unslop, then (/skill:simplify) and /skill:unslop again";
	expect(referencedSkills(text, NAMES)).toEqual(["unslop", "simplify"]);
});

test("a reference needs a known name, a boundary before it and the whole name", () => {
	expect(referencedSkills("/skill:nope and x/skill:simplify", NAMES)).toEqual([]);
	expect(referencedSkills("/skill:simplify-more", NAMES)).toEqual([]);
	expect(referencedSkills("/skill:ce-simplify-code", NAMES)).toEqual(["ce-simplify-code"]);
});

test("in backticks a reference stays text", () => {
	expect(referencedSkills("type `/skill:simplify` to call it", NAMES)).toEqual([]);
});

test("each reference is drawn in place, and the rest of the text stays", () => {
	const drawn = drawSkillRefs(
		"use /skill:simplify, then /skill:unslop",
		NAMES,
		(name) => `[${name}]`,
	);
	expect(drawn).toBe("use [simplify], then [unslop]");
});

test("the names come from the skills feature, and none without it", () => {
	const bus = createEventBus();
	expect(skillNames(bus)).toEqual([]);
	bus.on(SKILL_NAMES, (data: unknown) => addSkillNames(data, NAMES));
	expect(skillNames(bus)).toEqual(NAMES);
});
