import { boolean, setting, string } from "@adeildo/pi-kit";

export const SECTIONS = ["Asking", "Waiting"];

export const guidance = setting({
	id: "questions.guidance",
	default: "",
	decoder: string,
	ui: {
		section: "Asking",
		label: "When and how to ask",
		description:
			"Your own words for the model, added to the guidelines of the tool. Say when it should ask, or what it should show.",
		control: { type: "text", multiline: true },
	},
});

export const bell = setting({
	id: "questions.bell",
	default: true,
	decoder: boolean,
	ui: {
		section: "Waiting",
		label: "Ring the bell",
		description: "The terminal bell rings when the questions start waiting for you.",
	},
});

export const QUESTION_SETTINGS = [guidance, bell];
