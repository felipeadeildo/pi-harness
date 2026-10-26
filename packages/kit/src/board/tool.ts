// The board tool: one call, one operation. The card is a deliverable another can ask about and a
// third can check; steps of a day's work are not cards, and neither is another agent's work.
import { Type } from "@earendil-works/pi-ai";

import { applyBoard, blockedText, findBoard, type Board, type BoardOp } from "./model.ts";

/** A string that is one of these words: an `enum`, which every provider reads, and no `anyOf`. */
function oneOf<const T extends string>(values: readonly T[], description?: string) {
	return Type.Unsafe<T>({
		type: "string",
		enum: [...values],
		...(description ? { description } : {}),
	});
}

const TITLE = Type.String({
	description: "The result, up to eight words, in the operator's language. For add and edit.",
});
const COLUMN = oneOf(
	["backlog", "todo", "doing", "review", "done", "dropped"],
	"For add and move.",
);
const BLOCKED = Type.Object(
	{
		on: oneOf(["operator", "outside", "agent"]),
		handle: Type.Optional(Type.String({ description: "The agent's handle, when on is agent." })),
		why: Type.String({ description: "Why the card waits, in a few words." }),
	},
	{ description: "Who the card waits on. For add and edit." },
);

// One object rather than a union: a provider refuses a tool whose top-level schema is `anyOf`.
// `missingFor` checks each operation's fields.
export const BOARD_PARAMETERS = Type.Object({
	op: oneOf(["add", "move", "edit", "drop", "decide", "find"], "What to do."),
	title: Type.Optional(TITLE),
	id: Type.Optional(
		Type.String({
			description: "A card id from the last answer, like c3. For move, edit and drop.",
		}),
	),
	column: Type.Optional(COLUMN),
	pr: Type.Optional(Type.Number({ description: "The pull request number. For add and edit." })),
	blocked: Type.Optional(BLOCKED),
	reviewer: Type.Optional(Type.String({ description: "Who reviewed it. For move." })),
	result: Type.Optional(Type.String({ description: "How it ended. For move." })),
	now: Type.Optional(Type.String({ description: "What is being done now. For edit." })),
	why: Type.Optional(
		Type.String({ description: "Why the card is dropped, in a few words. For drop." }),
	),
	text: Type.Optional(
		Type.String({
			description: "The decision, in one sentence (decide), or what to look for (find).",
		}),
	),
});

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

/** What each operation needs, so a call that leaves one out is answered with which, not applied. */
const NEEDS: Record<BoardCallParams["op"], readonly string[]> = {
	add: ["title"],
	move: ["id", "column"],
	edit: ["id"],
	drop: ["id", "why"],
	decide: ["text"],
	find: ["text"],
};

/** The reason a call cannot run: an operation this board does not have, or a field it needs and lacks. */
export function missingFor(params: Record<string, unknown>): string | undefined {
	const needs = NEEDS[params.op as BoardCallParams["op"]];
	if (needs === undefined) return `There is no operation ${JSON.stringify(params.op)}.`;
	const lacking = needs.filter((field) => params[field] === undefined);
	return lacking.length === 0 ? undefined : `${params.op} needs ${lacking.join(" and ")}.`;
}

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
