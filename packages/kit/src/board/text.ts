import { BOARD_COLUMNS, blockedText, labelOf, type Board, type BoardCard } from "./model.ts";

export interface DescribeBoardOptions {
	done?: number;
	decisions?: number;
}

const SECTIONS = BOARD_COLUMNS.filter((one) => one.open || one.column === "backlog");

/** Keeps card ids, since the agent moves cards by them. */
export function describeBoard(board: Board, options: DescribeBoardOptions = {}): string {
	const lines: string[] = [];
	const section = (title: string, cards: readonly BoardCard[]) => {
		if (cards.length > 0) lines.push(`${title}:`, ...cards.map(cardLine));
	};
	for (const { column, label } of SECTIONS)
		section(
			label,
			board.cards.filter((card) => card.column === column),
		);
	const done = board.cards.filter((card) => card.column === "done");
	section(labelOf("done"), done.slice(-(options.done ?? Infinity)));
	const decisions = board.decisions.slice(-(options.decisions ?? Infinity));
	if (decisions.length > 0)
		lines.push("Decided:", ...decisions.map((decision) => `- ${decision.id} ${decision.text}`));
	return lines.join("\n");
}

function cardLine(card: BoardCard): string {
	const pr = card.pr === undefined ? "" : ` (#${card.pr})`;
	const asides = [
		card.now && `now: ${card.now}`,
		card.reviewer && `reviewer: ${card.reviewer}`,
		card.blocked && `blocked on ${blockedText(card.blocked, "agent")}`,
	].filter((part): part is string => typeof part === "string" && part !== "");
	const result = card.result === undefined ? "" : ` → ${card.result}`;
	const aside = asides.length === 0 ? "" : ` (${asides.join("; ")})`;
	return `- ${card.id} ${card.title}${pr}${result}${aside}`;
}
