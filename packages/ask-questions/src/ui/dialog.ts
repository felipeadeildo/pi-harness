import type { AskAnswer, AskResult } from "@adeildo/pi-kit";
// Drawn inline instead of as an overlay, so a tall dialog scrolls with the terminal.
import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type Focusable,
	Input,
	Key,
	type KeybindingsManager,
	type MarkdownTheme,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { answerSummary, isAnswered } from "../answers.ts";
import { type Question, TYPED_LABEL } from "../schema.ts";
import {
	besideColumns,
	COLUMN_GAP,
	type Layout,
	layoutFor,
	leftWidth,
	PreviewCache,
	previewBox,
} from "./preview.ts";

const POINTER = "\u276f ";
const INDENT = "     ";
const NOTE_TAG = "note ";
const CHECK = " \u2713";

interface Draft {
	picked: Set<number>;
	/** How a single choice was answered: an option, or the typed row. */
	via: "option" | "typed" | undefined;
	answered: boolean;
	notes: Input[];
	editor: Editor;
}

export interface QuestionDialogOptions {
	tui: Pick<TUI, "requestRender" | "terminal">;
	theme: Theme;
	markdownTheme: MarkdownTheme;
	keybindings: KeybindingsManager;
	questions: readonly Question[];
	complete: (result: AskResult) => void;
}

export class QuestionDialog implements Component, Focusable {
	private readonly theme: Theme;
	private readonly questions: readonly Question[];
	private readonly drafts: Draft[];
	private readonly previews: PreviewCache;
	private readonly keybindings: KeybindingsManager;
	private readonly requestRender: () => void;
	private readonly complete: (result: AskResult) => void;

	/** The question shown, or `questions.length` for the submit tab. */
	private tab = 0;
	/** The focused row: an option, or `options.length` for the typed row. */
	private row = 0;
	private noting = false;
	private done = false;

	private focusedFlag = false;
	get focused(): boolean {
		return this.focusedFlag;
	}
	set focused(value: boolean) {
		this.focusedFlag = value;
		this.syncFocus();
	}

	constructor(options: QuestionDialogOptions) {
		this.theme = options.theme;
		this.questions = options.questions;
		this.keybindings = options.keybindings;
		this.previews = new PreviewCache(options.markdownTheme);
		this.requestRender = () => options.tui.requestRender();
		this.complete = options.complete;

		const editorTheme = {
			borderColor: (text: string) => this.theme.fg("border", text),
			selectList: getSelectListTheme(),
		};
		// The editor reads only requestRender and terminal.rows.
		const tui = options.tui as TUI;
		this.drafts = this.questions.map((question) => {
			const editor = new Editor(tui, editorTheme, { paddingX: 0 });
			editor.onSubmit = (text) => this.submitTyped(text);
			return {
				picked: new Set<number>(),
				via: undefined,
				answered: false,
				notes: question.options.map(() => new Input()),
				editor,
			};
		});
	}

	handleInput(data: string): void {
		if (this.done) return;
		try {
			this.dispatch(data);
		} finally {
			this.syncFocus();
			this.requestRender();
		}
	}

	invalidate(): void {
		this.previews.invalidate();
		for (const draft of this.drafts) {
			draft.editor.invalidate();
			for (const input of draft.notes) input.invalidate();
		}
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const lines: string[] = [];
		if (this.questions.length > 1) lines.push(this.tabBar(inner), "");
		lines.push(...(this.onSubmitTab ? this.submitLines(inner) : this.questionLines(inner)));
		lines.push("", this.theme.fg("dim", this.hint()));
		return this.frame(lines, width, inner, this.title());
	}

	private get onSubmitTab(): boolean {
		return this.tab >= this.questions.length;
	}

	private get question(): Question | undefined {
		return this.questions[this.tab];
	}

	private get draft(): Draft | undefined {
		return this.drafts[this.tab];
	}

	private get onTypedRow(): boolean {
		const question = this.question;
		return question !== undefined && this.row === question.options.length;
	}

	private get rowCount(): number {
		return (this.question?.options.length ?? 0) + 1;
	}

	private syncFocus(): void {
		for (const [index, draft] of this.drafts.entries()) {
			const here = index === this.tab && this.focusedFlag;
			draft.editor.focused = here && this.onTypedRow;
			for (const [row, input] of draft.notes.entries())
				input.focused = here && this.noting && row === this.row;
		}
	}

	private dispatch(data: string): void {
		if (this.onSubmitTab) {
			this.dispatchSubmit(data);
			return;
		}
		if (this.noting) {
			this.dispatchNote(data);
			return;
		}
		if (this.onTypedRow) {
			this.dispatchTyped(data);
			return;
		}

		if (matchesKey(data, Key.escape)) return this.finish(true);
		if (matchesKey(data, Key.up)) return this.move(-1);
		if (matchesKey(data, Key.down)) return this.move(1);
		if (this.switchTab(data)) return;
		if (matchesKey(data, Key.tab)) {
			this.noting = true;
			return;
		}
		if (data === " " && this.question?.multiSelect) return this.toggle(this.row);
		if (this.isConfirm(data)) return this.confirmOption();

		const number = Number.parseInt(data, 10);
		if (data.length === 1 && number >= 1 && number <= this.rowCount) this.row = number - 1;
	}

	private dispatchNote(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab) || this.isConfirm(data)) {
			this.noting = false;
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			this.move(matchesKey(data, Key.up) ? -1 : 1);
			if (this.onTypedRow) this.noting = false;
			return;
		}
		this.draft?.notes[this.row]?.handleInput(data);
	}

	private dispatchTyped(data: string): void {
		const editor = this.draft?.editor;
		if (editor === undefined) return;
		if (matchesKey(data, Key.escape)) return this.move(-1);
		if (matchesKey(data, Key.up) && editor.getCursor().line === 0) return this.move(-1);
		editor.handleInput(data);
	}

	private dispatchSubmit(data: string): void {
		if (matchesKey(data, Key.escape)) return this.finish(true);
		if (this.switchTab(data)) return;
		if (this.isConfirm(data)) this.finish(false);
	}

	// Pi has two names for enter, and a setup where enter adds a newline rebinds one of them.
	private isConfirm(data: string): boolean {
		return (
			this.keybindings.matches(data, "tui.select.confirm") ||
			this.keybindings.matches(data, "tui.input.submit") ||
			matchesKey(data, Key.enter)
		);
	}

	private switchTab(data: string): boolean {
		const tabs = this.questions.length;
		if (tabs <= 1) return false;
		let delta = 0;
		if (matchesKey(data, Key.right)) delta = 1;
		else if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) delta = -1;
		if (delta === 0) return false;
		this.goTo((this.tab + delta + tabs + 1) % (tabs + 1));
		return true;
	}

	private move(delta: number): void {
		this.row = (this.row + delta + this.rowCount) % this.rowCount;
	}

	private toggle(row: number): void {
		const picked = this.draft?.picked;
		if (picked === undefined) return;
		if (picked.has(row)) picked.delete(row);
		else picked.add(row);
	}

	private confirmOption(): void {
		const draft = this.draft;
		if (draft === undefined) return;
		if (this.question?.multiSelect) {
			if (draft.picked.size === 0) draft.picked.add(this.row);
		} else {
			draft.picked = new Set([this.row]);
			draft.via = "option";
		}
		draft.answered = true;
		this.advance();
	}

	private submitTyped(text: string): void {
		const draft = this.draft;
		if (draft === undefined) return;
		const typed = text.trim();
		if (this.question?.multiSelect) {
			if (typed === "" && draft.picked.size === 0) return;
		} else {
			if (typed === "") return;
			draft.picked.clear();
			draft.via = "typed";
		}
		// The editor clears itself on submit.
		draft.editor.setText(typed);
		draft.answered = true;
		this.advance();
	}

	private advance(): void {
		if (this.questions.length === 1) return this.finish(false);
		const total = this.questions.length;
		for (let step = 1; step <= total; step++) {
			const next = (this.tab + step) % total;
			if (!this.drafts[next]?.answered) return this.goTo(next);
		}
		this.goTo(total);
	}

	private goTo(tab: number): void {
		this.tab = tab;
		this.noting = false;
		const draft = this.draft;
		const question = this.question;
		if (draft === undefined || question === undefined) return;
		const [first] = draft.picked;
		this.row = draft.via === "typed" ? question.options.length : (first ?? 0);
	}

	private finish(cancelled: boolean): void {
		this.done = true;
		this.complete({ answers: this.collect(), cancelled });
	}

	private collect(): AskAnswer[] {
		const answers: AskAnswer[] = [];
		for (const [index, question] of this.questions.entries()) {
			const answer = this.answerOf(index);
			const notes = this.notesOf(index);
			if (answer !== undefined) answers.push(answer);
			else if (notes.length > 0)
				answers.push({ question: question.question, header: question.header, picked: [], notes });
		}
		return answers;
	}

	private answerOf(index: number): AskAnswer | undefined {
		const question = this.questions[index];
		const draft = this.drafts[index];
		if (question === undefined || draft === undefined || !draft.answered) return undefined;

		const picked = question.options
			.filter((_, row) => draft.picked.has(row))
			.map((option) => option.label);
		const answer: AskAnswer = {
			question: question.question,
			header: question.header,
			picked,
			notes: this.notesOf(index),
		};
		const typed = draft.editor.getText().trim();
		if (typed !== "" && (question.multiSelect || draft.via === "typed")) answer.typed = typed;
		return isAnswered(answer) ? answer : undefined;
	}

	private notesOf(index: number): AskAnswer["notes"] {
		const question = this.questions[index];
		const draft = this.drafts[index];
		if (question === undefined || draft === undefined) return [];
		return question.options.flatMap((option, row) => {
			const note = draft.notes[row]?.getValue().trim() ?? "";
			return note === "" ? [] : [{ option: option.label, note }];
		});
	}

	private title(): string {
		if (this.questions.length > 1) return "questions";
		return this.question?.header ?? "question";
	}

	private tabBar(inner: number): string {
		const parts = this.questions.map((question, index) => {
			const text = this.drafts[index]?.answered ? `${question.header}${CHECK}` : question.header;
			return this.tabLabel(text, index === this.tab);
		});
		const submit = this.tabLabel("submit", this.onSubmitTab);
		return truncateToWidth([...parts, submit].join("   "), inner);
	}

	private tabLabel(text: string, current: boolean): string {
		return current ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("muted", text);
	}

	private questionLines(inner: number): string[] {
		const question = this.question;
		if (question === undefined) return [];
		const lines = wrapTextWithAnsi(question.question, inner).map((line) => this.theme.bold(line));
		lines.push("");

		if (this.onTypedRow || !question.options.some((option) => option.preview))
			return [...lines, ...this.rowLines(question, inner)];

		const preview = question.options[this.row]?.preview;
		if (layoutFor(inner) === "below") {
			const box = this.previewLines(preview, inner, "below");
			return [...lines, ...this.rowLines(question, inner), "", ...box];
		}

		const left = leftWidth(
			question.options.map((option) => option.label),
			inner,
		);
		const box = this.previewLines(preview, Math.max(1, inner - left - COLUMN_GAP), "beside");
		return [...lines, ...besideColumns(this.rowLines(question, left), box, left, inner)];
	}

	private previewLines(text: string | undefined, width: number, layout: Layout): string[] {
		if (!text) return [this.theme.fg("dim", "no preview for this option")];
		return previewBox(this.previews, text, width, layout, (line) => this.theme.fg("accent", line));
	}

	private rowLines(question: Question, width: number): string[] {
		const draft = this.draft;
		if (draft === undefined) return [];
		const lines: string[] = [];
		const room = Math.max(1, width - INDENT.length);

		for (const [row, option] of question.options.entries()) {
			const picked = draft.picked.has(row);
			if (question.multiSelect) {
				lines.push(this.rowHead(row, `${picked ? "[x]" : "[ ]"} ${option.label}`, false, width));
			} else {
				lines.push(this.rowHead(row, option.label, picked && draft.answered, width));
			}

			for (const line of wrapTextWithAnsi(option.description ?? "", room))
				lines.push(INDENT + this.theme.fg("muted", line));
			lines.push(...this.noteLines(draft, row, room));
		}

		lines.push(...this.typedLines(question, draft, width));
		return lines;
	}

	private noteLines(draft: Draft, row: number, room: number): string[] {
		const input = draft.notes[row];
		if (input === undefined) return [];
		const editing = this.noting && row === this.row;
		const text = input.getValue().trim();
		if (!editing && text === "") return [];

		const tag = this.theme.fg("warning", NOTE_TAG);
		const space = Math.max(1, room - NOTE_TAG.length);
		if (editing) return [INDENT + tag + (input.render(space)[0] ?? "")];
		const pad = " ".repeat(NOTE_TAG.length);
		return wrapTextWithAnsi(text, space).map(
			(line, index) => INDENT + (index === 0 ? tag : pad) + this.theme.fg("dim", line),
		);
	}

	private typedLines(question: Question, draft: Draft, width: number): string[] {
		const text = draft.editor.getText().trim();
		const done =
			draft.answered && text !== "" && (question.multiSelect === true || draft.via === "typed");
		const lines = [this.rowHead(question.options.length, TYPED_LABEL, done, width)];

		const room = Math.max(1, width - INDENT.length);
		if (this.onTypedRow) {
			for (const line of draft.editor.render(room)) lines.push(INDENT + line);
		} else if (text !== "") {
			for (const line of wrapTextWithAnsi(text, room).slice(0, 3))
				lines.push(INDENT + this.theme.fg("dim", line));
		}
		return lines;
	}

	private rowHead(row: number, label: string, done: boolean, width: number): string {
		const active = row === this.row;
		const pointer = active ? this.theme.fg("accent", POINTER) : "  ";
		const number = this.theme.fg(active ? "accent" : "dim", String(row + 1));
		const text = this.theme.fg(active ? "accent" : "text", label);
		const check = done ? this.theme.fg("success", CHECK) : "";
		return truncateToWidth(`${pointer}${number}  ${text}${check}`, width);
	}

	private submitLines(inner: number): string[] {
		const lines = [this.theme.bold("Review your answers"), ""];
		let missing = 0;
		for (const [index, question] of this.questions.entries()) {
			const answer = this.answerOf(index);
			const head = this.theme.fg("accent", question.header);
			if (answer === undefined) {
				missing++;
				lines.push(truncateToWidth(`${head}  ${this.theme.fg("warning", "not answered")}`, inner));
				continue;
			}
			lines.push(truncateToWidth(`${head}  ${answerSummary(answer)}`, inner));
			for (const { option, note } of answer.notes)
				lines.push(truncateToWidth(this.theme.fg("dim", `  note on ${option}: ${note}`), inner));
		}
		if (missing > 0) {
			const word = missing === 1 ? "question goes" : "questions go";
			lines.push("", this.theme.fg("warning", `${missing} ${word} back unanswered.`));
		}
		return lines;
	}

	private hint(): string {
		const tabs = this.questions.length > 1 ? "\u2190\u2192 question   " : "";
		if (this.onSubmitTab) return `${tabs}enter submit   esc cancel`;
		if (this.noting) return "type a note   \u2191\u2193 another option   enter done";
		if (this.onTypedRow) {
			const confirm = this.question?.multiSelect ? "enter confirm" : "enter answer";
			return `\u2191 options   ${confirm}   shift+enter new line   esc back`;
		}
		const pick = this.question?.multiSelect ? "space tick   enter confirm" : "enter choose";
		return `${tabs}\u2191\u2193 or 1-${this.rowCount} move   ${pick}   tab note   esc cancel`;
	}

	private frame(lines: string[], width: number, inner: number, title: string): string[] {
		const border = (text: string) => this.theme.fg("border", text);
		// 5 columns for "╭─ ", the space after the title, and "╮".
		const room = Math.max(0, width - 5);
		const label = this.theme.fg("accent", truncateToWidth(title, Math.max(0, room - 3), "..."));
		const dashes = Math.max(0, room - visibleWidth(label));
		const out = [
			`${border("\u256d\u2500 ")}${label}${border(` ${"\u2500".repeat(dashes)}\u256e`)}`,
		];
		for (const line of lines) {
			const clipped = truncateToWidth(line, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			out.push(`${border("\u2502")} ${clipped}${pad} ${border("\u2502")}`);
		}
		out.push(border(`\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256f`));
		return out;
	}
}
