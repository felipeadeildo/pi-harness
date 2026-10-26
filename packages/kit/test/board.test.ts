import { describe, expect, test } from "bun:test";

import {
	applyBoard,
	BOARD_COLUMNS,
	blockedText,
	boardView,
	emptyBoard,
	findBoard,
	foldBoard,
	isBoard,
	type Board,
	type BoardOp,
} from "../src/board/model.ts";
import { BOARD_PARAMETERS, boardCall, boardText, missingFor } from "../src/board/tool.ts";

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

	test("the blocker reads as you only to the operator, and names the agent the same way", () => {
		expect(blockedText(blocker, "operator")).toBe("você: which name?");
		expect(blockedText(blocker, "agent")).toBe("o operador: which name?");
		const agent = { on: "agent", handle: "quokka", why: "the review" } as const;
		expect(blockedText(agent, "operator")).toBe("@quokka: the review");
		expect(blockedText(agent, "agent")).toBe("@quokka: the review");
		const outside = { on: "outside", why: "the deploy" } as const;
		expect(blockedText(outside, "operator")).toBe("fora: the deploy");
	});
});

test("a board reads back only in the shape this version wrote", () => {
	const board = applied([
		added("Uma", { blocked: { on: "agent", handle: "quokka", why: "the review" } }),
	]);
	expect(isBoard(board)).toBe(true);
	expect(isBoard({ ...board, cards: [{ ...board.cards[0], column: "wip" }] })).toBe(false);
	expect(
		isBoard({ ...board, cards: [{ ...board.cards[0], blocked: { on: "agent", why: "x" } }] }),
	).toBe(false);
	expect(
		isBoard({ ...board, decisions: [{ id: "d1", text: "x", at: 1, by: { kind: "nobody" } }] }),
	).toBe(false);
});

test("a card waiting for the operator and one waiting for an agent read differently", () => {
	const board = applied([
		added("Uma", { blocked: { on: "operator", why: "o nome" } }),
		added("Outra", { blocked: { on: "agent", handle: "quokka", why: "a revisão" } }),
	]);
	const text = boardText(board);
	expect(text).toContain("o operador: o nome");
	expect(text).toContain("@quokka: a revisão");
});

test("the view takes the first open cards by arrival, then shows them oldest first", () => {
	const sixteen = Array.from({ length: 16 }, (_, index) => added(`Card ${index}`, { at: index }));
	const board = applied(sixteen, "operator");
	const view = boardView(board);
	expect(view.open).toHaveLength(15);
	expect(view.open.map((card) => card.title)).not.toContain("Card 15");
	// Arrival order is the only order. A card with a date older than the ones already on the board
	// is a state the product does not make: one writer per session appends, and no operation merges
	// (the model header says so). A board written through `applyBoard` cannot have ids out of arrival
	// order, since it numbers them `c${next}` as it appends; the ids and the dates run another way here
	// on purpose, so sorting by either would show.
	const hand: Board = {
		next: 4,
		cards: [
			{ id: "c3", title: "Primeira", column: "todo", at: 30 },
			{ id: "c1", title: "Segunda", column: "todo", at: 10 },
			{ id: "c2", title: "Terceira", column: "todo", at: 20 },
		],
		decisions: [],
	};
	expect(boardView(hand).open.map((card) => card.title)).toEqual([
		"Primeira",
		"Segunda",
		"Terceira",
	]);
});

describe("the board tool's answer", () => {
	const applied = (ops: BoardOp[]): Board => foldBoard(ops, "operator");
	const added = (title: string, at: number): BoardOp => ({ op: "add", title, at });

	test("a search nothing matches says so, and does not answer with an empty list", () => {
		const answer = boardCall(applied([added("ship the parser", 1)]), {
			op: "find",
			text: "no such card",
		});
		expect(answer).toEqual({ ok: true, text: "Nothing matches." });
	});

	test("a search that fits says nothing about a remainder", () => {
		const done: BoardOp = { op: "add", title: "ship the parser", column: "done", at: 1 };
		const answer = boardCall(applied([done]), { op: "find", text: "ship" });
		expect(answer.ok && answer.text).not.toContain("More:");
	});

	test("a search with more matches than fit says how many were left out", () => {
		// Only what is done answers a search: a card still open is not an outcome to look up.
		const many = Array.from({ length: 12 }, (_, at) => ({
			op: "add" as const,
			title: `card ${at}`,
			column: "done" as const,
			at,
		}));
		const answer = boardCall(applied(many), { op: "find", text: "card" });
		expect(answer.ok).toBe(true);
		expect(answer.ok && answer.text).toContain("More:");
	});
});

describe("the columns a board has", () => {
	test("every column has a word, and only the open ones count against the open cap", () => {
		const words = BOARD_COLUMNS.map((one) => one.label);
		expect(words.every((word) => word.trim() !== "")).toBe(true);
		expect(BOARD_COLUMNS.filter((one) => one.open).map((one) => one.column)).toEqual([
			"doing",
			"review",
			"todo",
		]);
	});
});

describe("the board tool as a provider reads it", () => {
	test("its schema is an object at the top, because a provider refuses a tool that is not", () => {
		// `Invalid schema for function 'board': schema must be a JSON Schema of 'type: "object"', got
		// 'type: null'` is what OpenAI answers to a union at the top, on the first call of the session.
		const schema = JSON.parse(JSON.stringify(BOARD_PARAMETERS)) as Record<string, unknown>;
		expect(schema.type).toBe("object");
		expect(schema).not.toHaveProperty("anyOf");
		expect(schema).not.toHaveProperty("oneOf");
		expect(schema.required).toEqual(["op"]);
	});

	test("every operation the model may name is in the enum, and nothing else", () => {
		const props = (BOARD_PARAMETERS as unknown as { properties: { op: { enum: string[] } } })
			.properties;
		expect(props.op.enum).toEqual(["add", "move", "edit", "drop", "decide", "find"]);
	});

	test("a call that leaves out what its operation needs is answered with which field", () => {
		expect(missingFor({ op: "add" })).toBe("add needs title.");
		expect(missingFor({ op: "move", id: "c1" })).toBe("move needs column.");
		expect(missingFor({ op: "drop" })).toBe("drop needs id and why.");
		expect(missingFor({ op: "find" })).toBe("find needs text.");
		expect(missingFor({ op: "decide", text: "ship it" })).toBeUndefined();
		expect(missingFor({ op: "add", title: "ship the parser" })).toBeUndefined();
	});

	test("an operation the board does not have is named, not applied", () => {
		expect(missingFor({ op: "rename", id: "c1" })).toBe('There is no operation "rename".');
	});
});
