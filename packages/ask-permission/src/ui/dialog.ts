import { renderDiff, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	type KeybindingsManager,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { type Scope, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";
import type { DialogAnswer, FolderOffer } from "#core/answer.ts";
import type { CallDescriptor } from "#core/tools.ts";
import { readClipboard } from "#ui/clipboard.ts";
import { type Choice, choicesFor, openLabel } from "#ui/decision-options.ts";
import {
	cleanPaste,
	expandPastes,
	PASTE_END,
	PASTE_START,
	pasteMarker,
	shouldCollapse,
} from "#ui/paste.ts";

type Phase = "menu" | "levels";

const TITLE_PREFIX = "\u256d\u2500 ";
const TITLE_SUFFIX = "\u256e";
// The 1 is the space between the title and its dashes.
const TITLE_CHROME_WIDTH = visibleWidth(TITLE_PREFIX) + 1 + visibleWidth(TITLE_SUFFIX);

const SUMMARY_ROWS = 3;
const DIFF_ROWS = 16;

interface AskDialogOptions {
	theme: Theme;
	toolName: string;
	target: CallDescriptor;
	diff?: string;
	/** Why the call asks, when a layer said. */
	reason?: string;
	offer?: FolderOffer;
	keybindings: KeybindingsManager;
	requestRender: () => void;
	complete: (answer: DialogAnswer) => void;
}

export class AskDialog implements Component, Focusable {
	private readonly theme: Theme;
	private readonly toolName: string;
	private readonly target: CallDescriptor;
	private readonly diff: string | undefined;
	private readonly reason: string | undefined;
	private readonly offer: FolderOffer | undefined;
	private readonly choices: Choice[];
	private readonly requestRender: () => void;
	private readonly complete: (answer: DialogAnswer) => void;
	private readonly keybindings: KeybindingsManager;

	private readonly noteInputs: Input[];

	private readonly pastes = new Map<number, string>();
	private pasteId = 0;
	private pasteBuffer = "";

	private phase: Phase = "menu";
	private selected = 0;
	private levelIndex = 0;
	private scopeIndex = 0;
	private pending: Choice | null = null;
	private noteIndex: number | null = null;
	private folderIndex = 0;
	private openScope: "session" | "project" = "session";

	private pendingNote: string | undefined;

	private get activeNoteInput(): Input | undefined {
		return this.noteIndex === null ? undefined : this.noteInputs[this.noteIndex];
	}

	private focusedFlag = false;
	get focused(): boolean {
		return this.focusedFlag;
	}
	set focused(value: boolean) {
		this.focusedFlag = value;
		for (const input of this.noteInputs) input.focused = value;
	}

	constructor(options: AskDialogOptions) {
		this.theme = options.theme;
		this.toolName = options.toolName;
		this.target = options.target;
		this.diff = options.diff;
		this.reason = options.reason;
		this.offer = options.offer;
		this.choices = choicesFor(options.offer);
		this.folderIndex = options.offer?.suggested ?? 0;
		// Reading a sibling folder is the common case, so its answer is where the cursor starts.
		if (options.offer?.access === "read") this.selected = 1;
		this.requestRender = options.requestRender;
		this.complete = options.complete;
		this.keybindings = options.keybindings;

		this.noteInputs = [...this.choices.keys()].map((index) => {
			const input = new Input({ prompt: "", placeholder: "" });
			input.onSubmit = () => this.choose(index);
			input.onEscape = () => {
				this.noteIndex = null;
			};
			return input;
		});
	}

	handleInput(data: string): void {
		try {
			this.dispatch(data);
		} finally {
			this.requestRender();
		}
	}

	invalidate(): void {
		for (const input of this.noteInputs) input.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const lines: string[] = [
			...this.summaryLines(inner),
			...this.reasonLines(),
			...this.diffLines(),
		];
		lines.push("");

		if (this.phase === "levels") {
			lines.push(...this.levelLines());
		} else {
			for (const [index, option] of this.choices.entries()) {
				lines.push(this.renderOption(option, index, inner));
			}
			lines.push("");
			lines.push(this.theme.fg("dim", this.hint()));
		}

		return this.frame(lines, width, inner, `permission \u00b7 ${this.toolName}`);
	}

	private dispatch(data: string): void {
		if (this.phase === "menu" && this.noteIndex !== null) {
			if (matchesKey(data, Key.up)) this.moveNote(-1);
			else if (matchesKey(data, Key.down)) this.moveNote(1);
			else if (matchesKey(data, Key.tab)) this.noteIndex = null;
			else this.handleNoteInput(data);
			return;
		}

		if (this.phase === "levels") {
			if (matchesKey(data, Key.up)) this.levelIndex = Math.max(0, this.levelIndex - 1);
			else if (matchesKey(data, Key.down))
				this.levelIndex = Math.min(this.target.levels.length - 1, this.levelIndex + 1);
			else if (matchesKey(data, Key.tab)) this.scopeIndex = (this.scopeIndex + 1) % SCOPES.length;
			else if (matchesKey(data, Key.enter)) this.confirmLevel();
			else if (matchesKey(data, Key.escape)) this.phase = "menu";
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.noteIndex = this.selected;
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.choose(this.selected);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.complete({ decision: "deny" });
			return;
		}
		if (this.onOpenChoice && this.adjustFolder(data)) return;

		const picked = this.choices.findIndex((option) => option.key === data);
		if (picked >= 0) this.selected = picked;
	}

	private get onOpenChoice(): boolean {
		return this.choices[this.selected]?.open === true;
	}

	// Left goes up toward the root, right back down toward the paths.
	private adjustFolder(data: string): boolean {
		const last = (this.offer?.folders.length ?? 1) - 1;
		if (matchesKey(data, Key.left)) {
			this.folderIndex = Math.max(0, this.folderIndex - 1);
			return true;
		}
		if (matchesKey(data, Key.right)) {
			this.folderIndex = Math.min(last, this.folderIndex + 1);
			return true;
		}
		if (data === "s") {
			this.openScope = this.openScope === "session" ? "project" : "session";
			return true;
		}
		return false;
	}

	private hint(): string {
		if (this.noteIndex !== null) return "\u2191\u2193 pick   enter confirm   esc back";

		const pick = `\u2191\u2193 or 1-${this.choices.length} pick`;
		if (!this.onOpenChoice) return `${pick}   enter confirm   tab note   esc deny`;

		const folders = (this.offer?.folders.length ?? 0) > 1 ? "\u2190\u2192 folder   " : "";
		const scope = this.openScope === "session" ? "keep for this project" : "only this session";
		return `${folders}s ${scope}   tab note   esc deny`;
	}

	private moveSelection(delta: number): void {
		const count = this.choices.length;
		this.selected = (this.selected + delta + count) % count;
	}

	private moveNote(delta: number): void {
		if (this.noteIndex === null) return;
		this.moveSelection(delta);
		this.noteIndex = this.selected;
	}

	private choose(index: number): void {
		const option = this.choices[index];
		if (!option) return;
		this.selected = index;

		const folder = this.offer?.folders[this.folderIndex];
		if (option.open && this.offer && folder !== undefined) {
			this.complete({
				decision: "allow",
				note: this.draftNote(),
				open: { path: folder, access: this.offer.access, scope: this.openScope },
			});
			return;
		}

		if (option.always) {
			this.pending = option;
			this.pendingNote = this.draftNote();
			this.noteIndex = null;
			this.levelIndex = this.target.levels.length - 1;
			this.scopeIndex = 0;
			this.phase = "levels";
			return;
		}

		this.complete({
			decision: option.decision,
			note: this.draftNote(),
			remember: option.always ? this.target.levels[0] : undefined,
		});
	}

	private confirmLevel(): void {
		const level = this.target.levels[this.levelIndex];
		if (!this.pending || level === undefined) return;

		this.complete({
			decision: this.pending.decision,
			note: this.pendingNote,
			remember: level,
			scope: this.currentScope,
		});
	}

	private get currentScope(): Scope {
		return SCOPES[this.scopeIndex] ?? "session";
	}

	private draftNote(): string | undefined {
		const input = this.activeNoteInput;
		if (!input) return undefined;

		const note = expandPastes(input.getValue(), this.pastes).trim();
		return note || undefined;
	}

	private handleNoteInput(data: string): void {
		if (this.pasteBuffer !== "" || data.includes(PASTE_START)) {
			this.bufferPaste(data);
			return;
		}

		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.pasteClipboard();
			return;
		}

		this.activeNoteInput?.handleInput(data);
	}

	private bufferPaste(data: string): void {
		const start = data.indexOf(PASTE_START);
		const text = this.pasteBuffer + (start === -1 ? data : data.slice(start + PASTE_START.length));
		const end = text.indexOf(PASTE_END);

		if (end === -1) {
			this.pasteBuffer = text;
			return;
		}

		this.pasteBuffer = "";
		const index = this.noteIndex;
		if (index !== null) this.insertPaste(index, text.slice(0, end));

		const rest = text.slice(end + PASTE_END.length);
		if (rest) this.handleNoteInput(rest);
	}

	private pasteClipboard(): void {
		const index = this.noteIndex;
		if (index === null) return;

		void readClipboard().then((text) => {
			if (!text) return;
			this.insertPaste(index, text);
			this.requestRender();
		});
	}

	private insertPaste(index: number, pastedText: string): void {
		const input = this.noteInputs[index];
		if (!input) return;

		const text = cleanPaste(pastedText);
		if (shouldCollapse(text)) {
			this.pasteId++;
			this.pastes.set(this.pasteId, text);
			input.handleInput(pasteMarker(this.pasteId, text));
			return;
		}

		const spacer = /^[/~.]/.test(text) && /\w$/.test(input.getValue()) ? " " : "";
		input.handleInput(spacer + text);
	}

	private levelLines(): string[] {
		const lines = [this.theme.fg("muted", "always yes for...")];

		for (const [index, level] of this.target.levels.entries()) {
			const active = index === this.levelIndex;
			const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
			lines.push(marker + this.theme.fg(active ? "accent" : "text", level));
		}

		if (this.pendingNote) lines.push(this.theme.fg("muted", `note: ${this.pendingNote}`));
		lines.push("");
		lines.push(
			this.theme.fg("muted", "scope: ") +
				this.theme.fg("accent", SCOPE_LABEL[this.currentScope]) +
				this.theme.fg("dim", "   (tab to change)"),
		);
		lines.push("");
		lines.push(this.theme.fg("dim", "\u2191\u2193 depth   tab scope   enter confirm   esc back"));
		return lines;
	}

	private renderOption(option: Choice, index: number, inner: number): string {
		const active = index === this.selected;
		const editing = this.noteIndex === index;
		const input = this.noteInputs[index];
		const draft = input?.getValue().trim() ?? "";
		const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
		const key = this.theme.fg(active ? "accent" : "dim", option.key);
		const prefix = `${marker}${key}  `;
		const text = this.labelOf(option);

		if (!editing && !draft) {
			const head = this.theme.fg(active ? option.tone : "text", text);
			return truncateToWidth(`${prefix}${head}${this.openTags(option, active)}`, inner);
		}

		const room = Math.max(1, inner - visibleWidth(prefix));
		const label = truncateToWidth(`${text}, `, room);
		const noteRoom = Math.max(1, room - visibleWidth(label));
		const note = editing
			? (input?.render(noteRoom)[0] ?? "")
			: this.theme.fg("dim", truncateToWidth(draft, noteRoom));
		const head = this.theme.fg(active ? option.tone : "text", label);
		return truncateToWidth(`${prefix}${head}${note}`, inner);
	}

	private labelOf(option: Choice): string {
		const folder = this.offer?.folders[this.folderIndex];
		if (!option.open || !this.offer || folder === undefined) return option.label;
		return openLabel(this.offer, folder);
	}

	// The scope shows once it is not the default, and the repository tag only where it helps.
	private openTags(option: Choice, active: boolean): string {
		if (!option.open || !this.offer) return "";
		const tags: string[] = [];
		if (this.openScope === "project") tags.push(this.theme.fg("accent", "for this project"));
		const folder = this.offer.folders[this.folderIndex];
		if (active && folder !== undefined && folder === this.offer.repoRoot)
			tags.push(this.theme.fg("dim", "repo root"));
		return tags.length === 0 ? "" : `  ${tags.join(this.theme.fg("dim", " \u00b7 "))}`;
	}

	private reasonLines(): string[] {
		const text = this.offer
			? `${this.offer.access === "read" ? "reads" : "writes"} outside the workspace`
			: this.reason;
		return text === undefined ? [] : [this.theme.fg("warning", `\u25b2 ${text}`)];
	}

	private diffLines(): string[] {
		if (!this.diff) return [];

		const lines = renderDiff(this.diff).split("\n");
		const shown = lines.slice(0, DIFF_ROWS);
		const hidden = lines.length - shown.length;
		if (hidden > 0) shown.push(this.theme.fg("dim", `\u2026 ${hidden} more lines`));
		return ["", ...shown];
	}

	private summaryLines(inner: number): string[] {
		const wrapped = wrapTextWithAnsi(this.target.summary || "(no input)", inner);
		const shown = wrapped.slice(0, SUMMARY_ROWS);
		const elideLast = wrapped.length > shown.length;

		return shown.map((line, index) => {
			const text =
				elideLast && index === shown.length - 1
					? `${truncateToWidth(line, Math.max(0, inner - 3))}...`
					: line;
			return this.theme.fg("muted", text);
		});
	}

	private frame(lines: string[], width: number, inner: number, title: string): string[] {
		const out: string[] = [this.topBorder(width, title)];

		for (const line of lines) {
			const clipped = truncateToWidth(line, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			out.push(
				`${this.theme.fg("border", "\u2502")} ${clipped}${pad} ${this.theme.fg("border", "\u2502")}`,
			);
		}

		out.push(this.theme.fg("border", `\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256f`));
		return out;
	}

	private topBorder(width: number, title: string): string {
		const room = Math.max(0, width - TITLE_CHROME_WIDTH);
		const label = this.theme.fg("accent", truncateToWidth(title, Math.max(0, room - 3), "..."));
		const dashes = Math.max(0, room - visibleWidth(label));

		return (
			this.theme.fg("border", TITLE_PREFIX) +
			label +
			this.theme.fg("border", ` ${"\u2500".repeat(dashes)}${TITLE_SUFFIX}`)
		);
	}
}
