// Ported from rpiv-ask-user-question.
import { Type } from "@earendil-works/pi-ai";

export const TOOL_NAME = "ask_questions";

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

export const TYPED_LABEL = "Type something.";

// Labels models use for a free answer, which the dialog already has.
export const RESERVED_LABELS: readonly string[] = ["Other", TYPED_LABEL, "Type an answer"];

export interface Option {
	label: string;
	description: string;
	preview?: string;
}

export interface Question {
	question: string;
	header: string;
	options: Option[];
	multiSelect?: boolean;
}

export interface QuestionParams {
	questions: Question[];
}

const option = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
		description: `At most ${MAX_LABEL_LENGTH} characters. What the user picks: 1 to 5 words.`,
	}),
	description: Type.String({
		description: "What picking this means, or what it costs.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Shown next to the options while this one is focused: an ASCII mockup, a code snippet, a diagram, a config or a diff. Markdown, monospace.",
		}),
	),
});

const question = Type.Object({
	question: Type.String({
		description: "The whole question, clear and specific, ending with a question mark.",
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description: `At most ${MAX_HEADER_LENGTH} characters. A short tag for the question, like "Auth method".`,
	}),
	options: Type.Array(option, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description: `${MIN_OPTIONS} to ${MAX_OPTIONS} distinct choices. The dialog adds a row for the user's own answer: do not write one.`,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description: "True when more than one option can be picked.",
		}),
	),
});

export const PARAMETERS = Type.Object({
	questions: Type.Array(question, {
		minItems: 1,
		maxItems: MAX_QUESTIONS,
		description: `1 to ${MAX_QUESTIONS} questions, asked in one dialog.`,
	}),
});
