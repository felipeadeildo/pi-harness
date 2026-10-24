import { describe, expect, test } from "bun:test";

import {
	applyBoard,
	blockedText,
	boardView,
	emptyBoard,
	findBoard,
	foldBoard,
	type Board,
	type BoardOp,
} from "../src/board/model.ts";

const at = 1;
const blocker = { on: "operator", why: "which name?" } as const;

function applied(ops: BoardOp[], writer: "agent" | "operator" = "agent"): Board {
	const result = foldBoard(ops, writer);
	return result;
}

function added(title: string, extra: Partial<Extract<BoardOp, { op: "add" }>> = {}): BoardOp {
	return { op: "add", title, at, ...extra };
}

describe("the board", () => {
	test("is the fold of its operations, with short ids never reused", () => {
		const board = applied([
			added("Porta vira setting"),
			{ op: "move", id: "c1", column: "doing", at },
			{ op: "decide", text: "o board substitui as tasks", at },
			{ op: "move", id: "c1", column: "done", result: "uma porta só", at },
		]);
		expect(board.cards).toHaveLength(1);
		expect(board.cards[0]).toMatchObject({ id: "c1", column: "done", result: "uma porta só" });
		expect(board.decisions[0]).toMatchObject({ id: "d2", text: "o board substitui as tasks" });
		expect(board.next).toBe(3);
	});

	test("a refused operation is skipped in the fold", () => {
		const board = applied([
			added("Uma", { column: "doing" }),
			added("Duas", { column: "doing" }),
			added("Três", { column: "doing" }),
			added("Quatro", { column: "doing" }),
		]);
		expect(board.cards).toHaveLength(3);
		expect(board.next).toBe(4);
	});
});

describe("what it refuses", () => {
	test("a title outside one to eight words", () => {
		expect(
			applyBoard(emptyBoard(), added("um dois três quatro cinco seis sete oito nove")).ok,
		).toBe(false);
		expect(applyBoard(emptyBoard(), added("um dois três quatro cinco seis sete oito")).ok).toBe(
			true,
		);
		expect(applyBoard(emptyBoard(), added("   ")).ok).toBe(false);
	});

	test("a second card for the same pull request", () => {
		const board = applied([added("Um", { pr: 188 })]);
		expect(applyBoard(board, added("Dois", { pr: 188 })).ok).toBe(false);
	});

	test("a card in review without its reviewer", () => {
		const board = applied([added("Um")]);
		const result = applyBoard(board, { op: "move", id: "c1", column: "review", at });
		expect(result.ok).toBe(false);
	});

	test("an unknown card", () => {
		expect(applyBoard(emptyBoard(), { op: "move", id: "c9", column: "todo", at }).ok).toBe(false);
		expect(applyBoard(emptyBoard(), { op: "drop", id: "c9", why: "x", at }).ok).toBe(false);
	});

	test("a fourth card in progress, for the agent and not for the operator", () => {
		const ops: BoardOp[] = [
			added("Um", { column: "doing" }),
			added("Dois", { column: "doing" }),
			added("Três", { column: "doing" }),
		];
		const board = applied(ops, "operator");
		expect(applyBoard(board, added("Quatro", { column: "doing" })).ok).toBe(false);
		expect(applyBoard(board, added("Quatro", { column: "doing" }), "operator").ok).toBe(true);
	});

	test("a sixteenth open card, for the agent and not for the operator", () => {
		const ops: BoardOp[] = Array.from({ length: 15 }, (_, index) => added(`Card ${index + 1}`));
		const board = applied(ops, "operator");
		expect(applyBoard(board, added("Dezesseis")).ok).toBe(false);
		expect(applyBoard(board, added("Dezesseis"), "operator").ok).toBe(true);
	});

	test("a fourth card in progress through a move is refused too", () => {
		const board = applied([
			added("Um", { column: "doing" }),
			added("Dois", { column: "doing" }),
			added("Três", { column: "doing" }),
			added("Quatro"),
		]);
		expect(applyBoard(board, { op: "move", id: "c4", column: "doing", at }).ok).toBe(false);
		expect(applyBoard(board, { op: "move", id: "c4", column: "doing", at }, "operator").ok).toBe(
			true,
		);
	});

	test("a move that adds a sixteenth open card is refused", () => {
		const ops: BoardOp[] = Array.from({ length: 15 }, (_, index) => added(`Card ${index + 1}`));
		ops.push(added("Backlog", { column: "backlog" }));
		const board = applied(ops, "operator");
		expect(applyBoard(board, { op: "move", id: "c16", column: "todo", at }).ok).toBe(false);
	});

	test("a drop without a reason", () => {
		const board = applied([added("Um")]);
		expect(applyBoard(board, { op: "drop", id: "c1", why: " ", at }).ok).toBe(false);
	});
});

describe("a field belongs to a column", () => {
	test("now is cleared as soon as the card leaves doing", () => {
		const board = applied([
			added("Um", { column: "doing" }),
			{ op: "edit", id: "c1", now: "rodando os testes", at },
			{ op: "move", id: "c1", column: "review", reviewer: "quokka", at },
		]);
		const card = board.cards[0];
		expect(card?.now).toBeUndefined();
		expect(card?.reviewer).toBe("quokka");
	});

	test("an edit cannot put now on a todo", () => {
		const board = applied([added("Um"), { op: "edit", id: "c1", now: "escrevendo", at }]);
		expect(board.cards[0]?.now).toBeUndefined();
	});

	test("leaving review clears the reviewer, and leaving done clears the result", () => {
		const board = applied([
			added("Um"),
			{ op: "move", id: "c1", column: "review", reviewer: "quokka", at },
			{ op: "move", id: "c1", column: "done", result: "mergeado", at },
			{ op: "move", id: "c1", column: "todo", at },
		]);
		expect(board.cards[0]?.reviewer).toBeUndefined();
		expect(board.cards[0]?.result).toBeUndefined();
	});
});

describe("what others read", () => {
	test("the view caps the open cards and keeps only three done", () => {
		const ops: BoardOp[] = [];
		for (let index = 0; index < 20; index += 1) ops.push(added(`Card ${index + 1}`));
		ops.push(added("Backlog", { column: "backlog" }));
		const board = applied(ops, "operator");
		const view = boardView(board);
		expect(view.open).toHaveLength(15);
		expect(view.backlog).toBe(1);
	});

	test("an old decision stays findable after the view's cap, because find reads the fold", () => {
		const ops: BoardOp[] = [{ op: "decide", text: "a decisão de vinte dias", at }];
		for (let index = 0; index < 31; index += 1) {
			ops.push(added(`Entrega ${index + 1}`));
			ops.push({ op: "move", id: `c${index + 2}`, column: "done", at });
		}
		const board = applied(ops, "operator");
		expect(boardView(board).done).toHaveLength(3);
		const found = findBoard(board, "vinte dias");
		expect(found.matches).toHaveLength(1);
		expect(found.matches[0]).toMatchObject({ text: "a decisão de vinte dias" });
	});

	test("find returns at most ten and says how many are left", () => {
		const ops: BoardOp[] = [];
		for (let index = 0; index < 12; index += 1) {
			ops.push(added(`Entrega igual ${index + 1}`));
			ops.push({ op: "move", id: `c${index + 1}`, column: "done", at });
		}
		const found = findBoard(applied(ops), "entrega igual");
		expect(found.matches).toHaveLength(10);
		expect(found.more).toBe(2);
	});

	test("the blocker names the thing, and reads as you only to the operator", () => {
		expect(blockedText(blocker, "operator")).toBe("waiting for you: which name?");
		expect(blockedText(blocker, "agent")).toBe("waiting for the operator: which name?");
		const agent = { on: "agent", handle: "@quokka", why: "the review" } as const;
		expect(blockedText(agent, "operator")).toBe("waiting for @quokka: the review");
	});
});
