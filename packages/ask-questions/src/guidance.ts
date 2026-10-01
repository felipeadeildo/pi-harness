import { MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, TYPED_LABEL } from "./schema.ts";

export const PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) instead of guessing`;

export const PROMPT_GUIDELINES: readonly string[] = [
	"Use ask_user_question when the request is underspecified and a wrong guess would cost a redo. Group every open question into one call, never back-to-back calls.",
	`Each question has ${MIN_OPTIONS}-${MAX_OPTIONS} options with a short label (1-5 words) and a description of what the choice means or costs. The dialog adds a "${TYPED_LABEL}" row for the user's own answer, so never write "Other" or a free-answer option yourself.`,
	"Give every option a preview whenever something can be shown: an ASCII mockup of the screen or layout, the code or config it leads to, a diagram, a diff. Skip it only when the label and description already say everything.",
	'The user can leave a note on any option, picked or not, to say why yes or why not. Read the notes as part of the answer. If you recommend an option, list it first and end its label with "(Recommended)".',
];

export const DESCRIPTION = `Ask the user one or more structured questions while you work. Use it to:
1. Gather preferences or requirements
2. Clear up an ambiguous instruction
3. Decide between implementation choices
4. Offer directions to take

How the dialog works:
- Each question shows its options, then a "${TYPED_LABEL}" row where the user writes their own answer. Never author "Other" or "${TYPED_LABEL}": those labels are rejected.
- multiSelect: true lets the user pick several options.
- The user can attach a note to any option, picked or not. The answer lists the picks, the typed answer and every note.
- If you recommend an option, put it first and add "(Recommended)" to the end of its label.

Previews:
Set \`preview\` on an option to show something concrete next to it while it is focused. Use it as much as you can:
- ASCII mockups of screens, layouts or components
- Code snippets of the different implementations
- Diagrams
- Configuration or diffs

A preview is markdown in a monospace box, multi-line is fine. It sits beside the options on a wide terminal and below them on a narrow one.`;
