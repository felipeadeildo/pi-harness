import { boolean, duration, nullable, setting, string } from "@adeildo/pi-kit";

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

export const typingPause = setting({
	id: "questions.typing.pause",
	default: 1000,
	decoder: duration,
	ui: {
		section: "Waiting",
		label: "Typing pause",
		description: "How long after you stop typing in the editor the questions open.",
	},
});

export const typingMaxWait = setting<number | null>({
	id: "questions.typing.maxWait",
	default: null,
	decoder: nullable(duration),
	ui: {
		section: "Waiting",
		label: "Typing wait cap",
		description:
			"The longest the questions wait while you type. Empty waits for as long as you type.",
	},
});

export const QUESTION_SETTINGS = [guidance, bell, typingPause, typingMaxWait];
