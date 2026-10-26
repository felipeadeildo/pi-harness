// Alt+O: one tool call's whole output in a scrollable frame, newest first; the arrows move between calls.
import { callTarget, CUT, frame, frameInner, FRAME_Y, GLYPH, type KeyHint } from "@adeildo/pi-kit";
import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface Output {
	tool: string;
	/** The path, the command, the query. */
	target: string;
	lines: string[];
	failed: boolean;
}

export function outputsOf(branch: readonly SessionEntry[]): Output[] {
	const calls = new Map<string, { tool: string; target: string }>();
	const outputs: Output[] = [];
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			for (const part of message.content)
				if (part.type === "toolCall")
					calls.set(part.id, { tool: part.name, target: callTarget(part.arguments) });
		}
		if (message.role !== "toolResult") continue;
		const call = calls.get(message.toolCallId);
		const text = message.content
			.map((part) => (part.type === "text" ? part.text : "[image]"))
			.join("\n")
			.trimEnd();
		if (text === "") continue;
		outputs.push({
			tool: call?.tool ?? message.toolName,
			target: call?.target ?? "",
			lines: text.split("\n"),
			failed: message.isError,
		});
	}
	return outputs;
}

export interface OutputViewOptions {
	theme: Theme;
	outputs: readonly Output[];
	rows: () => number;
	close: () => void;
}

export class OutputView implements Component {
	readonly #options: OutputViewOptions;
	/** Counted from the newest. */
	#index = 0;
	#scroll = 0;
	#width = 80;
	/** Wrapped again only when it or the width changes. */
	#wrapped: { output: Output; inner: number; lines: string[] } | undefined;
	/** Drawn again only when a key moved something. */
	#drawn:
		| { output: Output; width: number; scroll: number; page: number; lines: string[] }
		| undefined;

	constructor(options: OutputViewOptions) {
		this.#options = options;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.alt("o")) || data === "q")
			return this.#options.close();
		if (matchesKey(data, Key.up)) return this.#scrollBy(-1);
		if (matchesKey(data, Key.down)) return this.#scrollBy(1);
		if (matchesKey(data, Key.pageUp)) return this.#scrollBy(-this.#page());
		if (matchesKey(data, Key.pageDown)) return this.#scrollBy(this.#page());
		if (matchesKey(data, Key.home)) return this.#scrollBy(-Number.MAX_SAFE_INTEGER);
		if (matchesKey(data, Key.end)) return this.#scrollBy(Number.MAX_SAFE_INTEGER);
		if (matchesKey(data, Key.left)) return this.#move(1);
		if (matchesKey(data, Key.right)) return this.#move(-1);
	}

	render(width: number): string[] {
		this.#width = width;
		const { theme, outputs } = this.#options;
		const output = this.#current();
		if (output === undefined)
			return frame(theme, width, [theme.fg("muted", "No tool output in this session yet.")], {
				title: "Tool output",
				keys: [["esc", "close"]],
			});
		const lines = this.#lines(output);
		const page = this.#page();
		this.#scroll = Math.min(this.#scroll, Math.max(0, lines.length - page));
		const known = this.#drawn;
		if (
			known !== undefined &&
			known.output === output &&
			known.width === width &&
			known.scroll === this.#scroll &&
			known.page === page
		)
			return known.lines;

		const shown = lines
			.slice(this.#scroll, this.#scroll + page)
			.map((line) => theme.fg("toolOutput", line));
		const last = Math.min(lines.length, this.#scroll + page);
		const keys: KeyHint[] = [
			["↑↓", "scroll"],
			["←→", "calls"],
			["esc", "close"],
		];
		const drawn = frame(theme, width, shown, {
			title: this.#title(output),
			status: theme.fg("muted", `${this.#index + 1} of ${outputs.length}`),
			keys,
			footnote: theme.fg("muted", `lines ${this.#scroll + 1}-${last} of ${lines.length}`),
		});
		this.#drawn = { output, width, scroll: this.#scroll, page, lines: drawn };
		return drawn;
	}

	invalidate(): void {
		this.#wrapped = undefined;
		this.#drawn = undefined;
	}

	#title(output: Output): string {
		const { theme } = this.#options;
		const mark = output.failed ? theme.fg("error", GLYPH.cross) : theme.fg("success", GLYPH.check);
		const room = Math.max(8, Math.floor(this.#width / 2) - output.tool.length);
		const target = truncateToWidth(output.target, room, CUT);
		return `${mark} ${theme.fg("toolTitle", theme.bold(output.tool))} ${theme.fg("muted", target)}`;
	}

	#current(): Output | undefined {
		const { outputs } = this.#options;
		return outputs[outputs.length - 1 - this.#index];
	}

	#lines(output: Output): string[] {
		const inner = frameInner(this.#width);
		const known = this.#wrapped;
		if (known !== undefined && known.output === output && known.inner === inner) return known.lines;
		const lines = output.lines.flatMap((line) => wrapTextWithAnsi(line, inner));
		this.#wrapped = { output, inner, lines };
		return lines;
	}

	#page(): number {
		return Math.max(1, this.#options.rows() - FRAME_Y);
	}

	#scrollBy(rows: number): void {
		this.#scroll = Math.max(0, this.#scroll + rows);
	}

	#move(step: number): void {
		const next = this.#index + step;
		if (next < 0 || next >= this.#options.outputs.length) return;
		this.#index = next;
		this.#scroll = 0;
	}
}
