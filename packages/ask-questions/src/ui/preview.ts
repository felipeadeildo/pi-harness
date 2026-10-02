// Ported from rpiv-ask-user-question.
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

const FENCE = /^`{3}/;
// oxlint-disable-next-line no-control-regex -- it matches the escape codes Markdown writes
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** O markdown dos previews, desenhado uma vez por largura. */
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
				.filter((line) => !FENCE.test(line.replace(ANSI, "")));
			// Markdown ends in blank lines that would pad the panel.
			while (lines.length > 0 && (lines.at(-1) ?? "").replace(ANSI, "").trim() === "") lines.pop();
			this.rendered.set(key, lines);
		}
		return lines;
	}

	invalidate(): void {
		this.rendered.clear();
	}
}
