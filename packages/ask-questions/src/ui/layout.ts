// A geometria do diálogo. Tudo aqui é decidido pela pergunta e pelo terminal, nunca pela linha sob o
// cursor: reservar o espaço antes de precisar é o que impede o diálogo de pular quando o foco anda.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Layout = "beside" | "below";

/** O filete entre as opções e o painel, com um espaço de cada lado. */
export const DIVIDER = " \u2502 ";
const DIVIDER_WIDTH = 3;

/** Mais largo que isto, o diálogo para de crescer e centraliza. */
const MAX_FRAME = 164;
/** Abaixo disto o painel vai embaixo das opções, em vez de ao lado. */
const MIN_BESIDE = 100;
const MIN_LEFT = 34;
const MAX_LEFT_RATIO = 0.45;
/** O ponteiro, o número e a marca de resposta, mais folga para a nota que fica na linha. */
const LEFT_EXTRA = 24;

/** O painel mais baixo que ainda comporta o título e o editor da resposta livre. */
export const PANEL_MIN_ROWS = 7;
const PANEL_MAX_ROWS = 18;

export function layoutFor(inner: number): Layout {
	return inner + 4 >= MIN_BESIDE ? "beside" : "below";
}

/** Cabe o label mais longo com folga para a nota, e nunca passa de 45% da largura. */
export function leftWidth(labels: readonly string[], inner: number): number {
	const longest = Math.max(0, ...labels.map((label) => visibleWidth(label)));
	return Math.max(MIN_LEFT, Math.min(longest + LEFT_EXTRA, Math.floor(inner * MAX_LEFT_RATIO)));
}

export function panelWidth(inner: number, left: number): number {
	return Math.max(1, inner - left - DIVIDER_WIDTH);
}

/** A largura do próprio diálogo, limitada para um terminal de 250 colunas não esticá-lo. */
export function frameWidth(width: number): number {
	return Math.min(width, MAX_FRAME);
}

export function centerPad(width: number, frame: number): number {
	return Math.max(0, Math.floor((width - frame) / 2));
}

/** Quantas linhas o painel pede: o título, um respiro e o conteúdo mais alto da pergunta. */
export function panelRows(tallestContent: number, terminalRows: number): number {
	const cap = Math.max(PANEL_MIN_ROWS, Math.min(PANEL_MAX_ROWS, Math.floor(terminalRows * 0.4)));
	return Math.max(PANEL_MIN_ROWS, Math.min(tallestContent + 2, cap));
}

/** Duas colunas lado a lado com o filete no meio, até a mais alta e cortadas em `width`. */
export function mergeColumns(
	left: readonly string[],
	right: readonly string[],
	leftCols: number,
	rule: (text: string) => string,
	width: number,
): string[] {
	const rows = Math.max(left.length, right.length);
	const divider = rule(DIVIDER);
	const out: string[] = [];
	for (let row = 0; row < rows; row++) {
		const cell = truncateToWidth(left[row] ?? "", leftCols, "");
		const pad = " ".repeat(Math.max(0, leftCols - visibleWidth(cell)));
		out.push(truncateToWidth(`${cell}${pad}${divider}${right[row] ?? ""}`, width, ""));
	}
	return out;
}
