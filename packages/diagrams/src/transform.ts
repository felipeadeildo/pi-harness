// Replaces each top-level ```mermaid block of a message with its diagram: a picture where the terminal
// shows images, Unicode art where it does not, and the source with the reason when neither draws it.
import type {
	MarkdownTransformContext,
	MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import {
	type CellDimensions,
	type ImageProtocol,
	Marked,
	renderImage,
	type TerminalColors,
	type Tokens,
} from "@earendil-works/pi-tui";

import { peleColors, type ThemeColors } from "./colors.ts";
import { draw } from "./draw.ts";
import { MONO_ADVANCE, monoFont } from "./font.ts";
import { longestDrawable } from "./partial.ts";
import { asciiDiagram, codeSpan } from "./text.ts";

/** What the transform reads from the terminal, each time it draws. */
export interface Surface {
	theme(): ThemeColors | undefined;
	terminal(): TerminalColors;
	images(): ImageProtocol;
	hyperlinks(): boolean;
	cell(): CellDimensions;
	rows(): number;
}

const CACHE_SIZE = 48;
const BLANK_ROW = codeSpan("");

const lexer = new Marked();

export function diagramTransformer(surface: Surface): MarkdownTransformer {
	const drawn = new Map<string, string>();
	let streaming: { text: string; lines: number; markdown: string } | undefined;

	function remember(key: string, markdown: string): string {
		drawn.delete(key);
		drawn.set(key, markdown);
		if (drawn.size > CACHE_SIZE) drawn.delete(drawn.keys().next().value ?? "");
		return markdown;
	}

	function picture(text: string, theme: ThemeColors, width: number): string {
		const colors = peleColors(theme, surface.terminal());
		const cell = surface.cell();
		const rows = surface.rows();
		const key = [JSON.stringify(colors), width, cell.widthPx, cell.heightPx, rows, text].join("\n");
		const known = drawn.get(key);
		if (known !== undefined) return remember(key, known);
		const drawing = draw(text, {
			colors,
			font: monoFont(),
			fontSize: cell.widthPx / MONO_ADVANCE,
			cell,
			maxColumns: width,
			maxRows: rows,
		});
		const base64 = drawing.png.toString("base64");
		// The PNG fills these cells exactly, so the terminal shows it at its own size.
		const image = renderImage(
			base64,
			{
				widthPx: drawing.columns * cell.widthPx,
				heightPx: drawing.rows * cell.heightPx,
			},
			{
				maxWidthCells: drawing.columns,
				maxHeightCells: drawing.rows,
				imageId: imageId(key),
				moveCursor: false,
			},
		);
		if (image === null) throw new Error("the terminal cannot show this picture");
		const lines = [image.sequence, ...Array.from({ length: image.rows - 1 }, () => BLANK_ROW)];
		return remember(key, `${lines.join("  \n")}\n`);
	}

	function block(token: Tokens.Code, context: MarkdownTransformContext): string {
		const theme = surface.theme();
		if (theme === undefined) return token.raw;
		const width = context.availableWidth;
		const show =
			surface.images() === null
				? (text: string) => asciiDiagram(text, theme, width, surface.hyperlinks())
				: (text: string) => picture(text, theme, width);
		const complete = !context.isStreaming || closed(token.raw);

		if (complete) {
			streaming = undefined;
			try {
				return show(token.text);
			} catch (error) {
				return `${token.raw}\n${codeSpan(theme.fg("warning", `Diagram not drawn: ${reason(error)}`))}  \n`;
			}
		}

		const before = streaming && token.text.startsWith(streaming.text) ? streaming : undefined;
		const found = longestDrawable(token.text, false, show, before?.lines);
		if (found) streaming = { text: found.text, lines: found.lines, markdown: found.drawn };
		return found?.drawn ?? before?.markdown ?? token.raw;
	}

	return (markdown, context) => {
		if (!/^ {0,3}(`{3,}|~{3,})\s*mermaid/im.test(markdown)) return markdown;
		return lexer
			.lexer(markdown)
			.map((token) => (isMermaid(token) ? block(token, context) : token.raw))
			.join("");
	};
}

function isMermaid(token: { type: string; lang?: string }): token is Tokens.Code {
	return (
		token.type === "code" && token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid"
	);
}

/** A fence that has its closing line; a block still being written does not. */
function closed(raw: string): boolean {
	const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
	if (open === undefined) return true;
	const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? "";
	return (
		raw.trimEnd().includes("\n") &&
		last.startsWith(open) &&
		last.replaceAll(open[0] ?? "", "") === ""
	);
}

function reason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n", 1)[0] ?? message;
}

/** A Kitty image id from the drawing's key: the same drawing reuses its upload, another never does. */
function imageId(key: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index++) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0 || 1;
}
