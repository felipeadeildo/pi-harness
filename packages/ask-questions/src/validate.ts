import {
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type Option,
	type Question,
	type QuestionParams,
	RESERVED_LABELS,
} from "./schema.ts";

// Some models emit a bare `\r` at token boundaries, which sends the terminal cursor to column 0.
// Pi's display keeps `\r\n` as a newline and drops the rest, and so does this.
export function normalizeText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

/** Runs before validation, so a reserved label cannot hide behind a `\r`. */
export function normalizeParams(params: QuestionParams): QuestionParams {
	return {
		questions: params.questions.map((question) => ({
			...question,
			question: normalizeText(question.question),
			header: normalizeText(question.header),
			options: question.options.map(normalizeOption),
		})),
	};
}

function normalizeOption(option: Option): Option {
	const clean: Option = {
		label: normalizeText(option.label),
		description: normalizeText(option.description),
	};
	if (option.preview !== undefined) clean.preview = normalizeText(option.preview);
	return clean;
}

const RESERVED = new Set(RESERVED_LABELS.map((label) => label.toLowerCase()));

/** What the schema cannot say. Undefined when the questions can be asked. */
export function problemWith(params: QuestionParams): string | undefined {
	const { questions } = params;
	if (questions.length === 0) return "at least one question is required";
	if (questions.length > MAX_QUESTIONS) return `at most ${MAX_QUESTIONS} questions in one call`;

	const asked = new Set<string>();
	for (const question of questions) {
		if (asked.has(question.question)) return `"${question.question}" is asked twice`;
		asked.add(question.question);

		const problem = optionProblem(question);
		if (problem !== undefined) return `"${question.question}": ${problem}`;
	}
	return undefined;
}

function optionProblem(question: Question): string | undefined {
	if (question.options.length < MIN_OPTIONS) return `needs at least ${MIN_OPTIONS} options`;

	const labels = new Set<string>();
	for (const { label } of question.options) {
		if (RESERVED.has(label.trim().toLowerCase()))
			return `"${label}" is reserved: the dialog already has a row for the user's own answer`;
		if (labels.has(label)) return `"${label}" is listed twice`;
		labels.add(label);
	}
	return undefined;
}
