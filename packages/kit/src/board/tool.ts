// The board tool: one call, one operation. The card is a deliverable another can ask about and a
// third can check; steps of a day's work are not cards, and neither is another agent's work.
import { Type } from "@earendil-works/pi-ai";

import { applyBoard, blockedText, findBoard, type Board, type BoardOp } from "./model.ts";

const TITLE = Type.String({
	description: "The result, up to eight words, in the operator's language.",
});
const ID = Type.String({ description: "A card id from the last answer, like c3." });
const COLUMN = Type.Union([
	Type.Literal("backlog"),
	Type.Literal("todo"),
	Type.Literal("doing"),
	Type.Literal("review"),
	Type.Literal("done"),
	Type.Literal("dropped"),
]);
const WHY = Type.String({ description: "Why the card waits, in a few words." });
const BLOCKED = Type.Object({
	on: Type.Union([Type.Literal("operator"), Type.Literal("outside"), Type.Literal("agent")]),
	handle: Type.Optional(Type.String({ description: "The agent's handle, when on is agent." })),
	why: WHY,
});

function shape(
	name: string,
	fields: Record<string, unknown>,
	optional: Record<string, unknown> = {},
) {
	return Type.Object({
		op: Type.Literal(name),
		...fields,
		...Object.fromEntries(
			Object.entries(optional).map(([key, schema]) => [key, Type.Optional(schema as never)]),
		),
	});
}

export const BOARD_PARAMETERS = Type.Union([
	shape("add", { title: TITLE }, { column: COLUMN, pr: Type.Number(), blocked: BLOCKED }),
	shape("move", { id: ID, column: COLUMN }, { reviewer: Type.String(), result: Type.String() }),
	shape(
		"edit",
		{ id: ID },
		{ title: TITLE, pr: Type.Number(), now: Type.String(), blocked: BLOCKED },
	),
	shape("drop", { id: ID, why: WHY }),
	shape("decide", { text: Type.String({ description: "The decision, in one sentence." }) }),
	shape("find", { text: Type.String({ description: "What to look for." }) }),
]);

export const BOARD_DESCRIPTION = `Keeps the session's board: what it is doing now, what waits for whom, and what it already delivered.

A card is a deliverable another can ask "how is it going?" about and whose end a third can check: a merged PR, a report, a review with a verdict, an answered question. One card per PR, with its number. Steps of the work (running tests, a rebase, reading a file) are not cards, and another agent's work belongs on their board.

Writes return the open board, with the ids to use next. A write that breaks a rule answers with the reason, in place of the board.`;

export function boardText(board: Board): string {
	if (board.cards.length === 0 && board.decisions.length === 0) return "The board is empty.";
	const lines = board.cards.map((card) => {
		const wait = card.blocked === undefined ? "" : ` (${blockedText(card.blocked, "agent")})`;
		const now = card.now === undefined ? "" : ` — ${card.now}`;
		return `${card.id} [${card.column}] ${card.title}${now}${wait}`;
	});
	return lines.join("\n");
}

export type BoardCallParams = BoardOp | { op: "find"; text: string };
export type BoardToolResult = { ok: true; text: string } | { ok: false; why: string };

export function boardCall(board: Board, params: BoardCallParams): BoardToolResult {
	if (params.op === "find") {
		const found = findBoard(board, params.text);
		if (found.matches.length === 0) return { ok: true, text: "Nothing matches." };
		const lines = found.matches.map((one) => `${one.id} ${"title" in one ? one.title : one.text}`);
		const more = found.more > 0 ? `\nMore: ${found.more}` : "";
		return { ok: true, text: lines.join("\n") + more };
	}
	const result = applyBoard(board, params, "agent");
	if (!result.ok) return result;
	return { ok: true, text: boardText(result.board) };
}
