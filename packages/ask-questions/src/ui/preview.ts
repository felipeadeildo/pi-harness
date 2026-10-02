// Ported from rpiv-ask-user-question.
import { Markdown, type MarkdownTheme, stripTerminalSequences } from "@earendil-works/pi-tui";

const FENCE = /^`{3}/;

/** The markdown of the previews, drawn once per width. */
export class PreviewCache {
	private readonly rendered = new Map<string, string[]>();

	constructor(private readonly theme: MarkdownTheme) {}

	lines(text: string, width: number): string[] {
		const key = `${width}\u0000${text}`;
		let lines = this.rendered.get(key);
		if (lines === undefined) {
			// pi-tui prints the fence lines of code blocks.
			lines = new Markdown(text, 0, 0, this.theme)
				.render(Math.max(1, width))
				.filter((line) => !FENCE.test(stripTerminalSequences(line)));
			// Markdown ends in blank lines that would pad the panel.
			while (lines.length > 0 && stripTerminalSequences(lines.at(-1) ?? "").trim() === "")
				lines.pop();
			this.rendered.set(key, lines);
		}
		return lines;
	}

	invalidate(): void {
		this.rendered.clear();
	}
}
