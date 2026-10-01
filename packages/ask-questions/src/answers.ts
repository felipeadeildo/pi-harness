// The tool result's `details`, so each answer is stored in the session with the call that asked it.
import type { Question } from "./schema.ts";

export interface OptionNote {
	option: string;
	note: string;
}

export interface Answer {
	question: string;
	header: string;
	/** The labels picked. One at most for a single choice, and none when only a typed answer came. */
	picked: string[];
	typed?: string;
	/** A note on any option, picked or not. */
	notes: OptionNote[];
}

export interface QuestionsResult {
	/** Only the answered questions, in the order asked. */
	answers: Answer[];
	cancelled: boolean;
	/** Why the questions never reached the user. */
	error?: string;
}

export function isAnswered(answer: Answer | undefined): answer is Answer {
	if (answer === undefined) return false;
	return answer.picked.length > 0 || (answer.typed ?? "").trim() !== "";
}

const NOT_SEEN =
	"The user never saw the questions, so this is not a decline. Ask them in the chat instead.";

export function answerText(result: QuestionsResult, questions: readonly Question[]): string {
	if (result.error !== undefined) return `${result.error}. ${NOT_SEEN}`;

	const answered = result.answers.filter(isAnswered);
	if (result.cancelled) {
		const lines = ["The user closed the questions without submitting. Do not assume an answer."];
		if (answered.length > 0)
			lines.push("Before closing they had answered:", ...answerLines(answered));
		return lines.join("\n");
	}
	if (answered.length === 0) return "The user submitted without answering any question.";

	const lines = ["The user answered:", ...answerLines(answered)];
	const skipped = questions.filter(
		(question) => !answered.some((a) => a.question === question.question),
	);
	if (skipped.length > 0)
		lines.push(
			`Left unanswered: ${skipped.map((question) => `"${question.question}"`).join(", ")}`,
		);
	lines.push("Continue with these answers in mind.");
	return lines.join("\n");
}

function answerLines(answers: readonly Answer[]): string[] {
	const lines: string[] = [];
	for (const answer of answers) {
		lines.push(`- ${answer.header}: "${answer.question}" → ${answerSummary(answer)}`);
		for (const { option, note } of answer.notes) {
			const tag = answer.picked.includes(option) ? "" : " (not picked)";
			lines.push(`  note on "${option}"${tag}: ${note}`);
		}
	}
	return lines;
}

export function answerSummary(answer: Answer): string {
	const parts = answer.picked.map((label) => `"${label}"`);
	const typed = answer.typed?.trim();
	if (typed) parts.push(`in their words: "${typed}"`);
	return parts.length === 0 ? "(nothing)" : parts.join(", ");
}
