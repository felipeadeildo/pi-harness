import { boolean, setting } from "@adeildo/pi-kit";

export const SECTIONS = ["System prompt"];

export const listed = setting({
	id: "skills.list",
	default: false,
	decoder: boolean,
	ui: {
		section: "System prompt",
		label: "List every skill",
		description:
			"Pi lists each skill with its description in the system prompt, so the model picks one on its own. Off, the prompt only says where the skills are, and you call them with /skill:name.",
	},
});

export const SKILL_SETTINGS = [listed];
