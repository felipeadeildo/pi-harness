import { BOARD_COLUMNS, blockedText, labelOf, type Board, type BoardCard } from "./model.ts";

export interface DescribeBoardOptions {
	done?: number;
	decisions?: number;
}

/**
 * The sections the summary draws: the board's own order, and the backlog with them because it is what
 * the person will pick up even though no cap counts it.
 */
const SECTIONS = BOARD_COLUMNS.filter((one) => one.open || one.column === "backlog");

/**
 * Where the session stands, for a prompt the agent reads after its history is cut. The ids stay,
 * because the agent moves its cards by them. Cards keep the board's order, and the cut on done cards
 * and decisions keeps the last ones in that order, as the view other sessions read does.
 */
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
