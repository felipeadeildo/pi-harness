// The board is the deliverable each session keeps: what it is doing now, what waits for whom, and
// what it already delivered. It is a fold of operations, one writer per session, so a `/tree` or a
// fork carries the board with it and no operation has to be merged.
import type { By } from "../contracts/by.ts";

export type BoardColumn = "backlog" | "todo" | "doing" | "review" | "done" | "dropped";

/**
 * Why a card waits, and for whom. The value names the thing, never the reader: `operator` reads as
 * "you" only on the operator's screen, and "the operator" in every other session's prompt.
 */
export type BoardBlocker = { why: string } & (
	| { on: "operator" }
	| { on: "outside" }
	| { on: "agent"; handle: string }
);

export interface BoardCard {
	id: string;
	title: string;
	column: BoardColumn;
	pr?: number;
	now?: string;
	blocked?: BoardBlocker;
	reviewer?: string;
	result?: string;
	why?: string;
	at: number;
}

export interface BoardDecision {
	id: string;
	text: string;
	by?: By;
	at: number;
}

export interface Board {
	next: number;
	cards: BoardCard[];
	decisions: BoardDecision[];
}

export type BoardOp =
	| {
			op: "add";
			title: string;
			column?: BoardColumn;
			pr?: number;
			blocked?: BoardBlocker;
			at: number;
	  }
	| { op: "move"; id: string; column: BoardColumn; reviewer?: string; result?: string; at: number }
	| {
			op: "edit";
			id: string;
			title?: string;
			pr?: number;
			now?: string;
			blocked?: BoardBlocker | null;
			at: number;
	  }
	| { op: "drop"; id: string; why: string; at: number }
	| { op: "decide"; text: string; by?: By; at: number };

export type BoardResult = { ok: true; board: Board } | { ok: false; why: string };

/** Who writes: the agent keeps the board small, the operator may go past the limits. */
export type BoardWriter = "agent" | "operator";

const IN_PROGRESS = 3;
const OPEN = 15;
const TITLE_WORDS = 8;
const TOO_MANY = 10;

export function emptyBoard(): Board {
	return { next: 1, cards: [], decisions: [] };
}

const OPEN_COLUMNS: ReadonlySet<BoardColumn> = new Set(["todo", "doing", "review"]);

export function applyBoard(board: Board, op: BoardOp, writer: BoardWriter = "agent"): BoardResult {
	switch (op.op) {
		case "add":
			return add(board, op, writer);
		case "move":
			return move(board, op, writer);
		case "edit":
			return edit(board, op);
		case "drop":
			return drop(board, op);
		case "decide": {
			const id = `d${board.next}`;
			return {
				ok: true,
				board: {
					next: board.next + 1,
					cards: board.cards,
					decisions: [
						...board.decisions,
						{ id, text: op.text.trim(), ...(op.by === undefined ? {} : { by: op.by }), at: op.at },
					],
				},
			};
		}
	}
}

function add(board: Board, op: Extract<BoardOp, { op: "add" }>, writer: BoardWriter): BoardResult {
	const title = op.title.trim();
	const bad = badTitle(title);
	if (bad !== undefined) return { ok: false, why: bad };
	if (op.pr !== undefined && board.cards.some((card) => card.pr === op.pr)) {
		return { ok: false, why: `a card for #${op.pr} already exists` };
	}
	const column = op.column ?? "todo";
	const id = `c${board.next}`;
	const card: BoardCard = {
		id,
		title,
		column,
		at: op.at,
		...(op.pr === undefined ? {} : { pr: op.pr }),
		...(op.blocked === undefined ? {} : { blocked: op.blocked }),
	};
	return guarded(
		{ next: board.next + 1, cards: [...board.cards, card], decisions: board.decisions },
		writer,
	);
}

function move(
	board: Board,
	op: Extract<BoardOp, { op: "move" }>,
	writer: BoardWriter,
): BoardResult {
	const card = board.cards.find((one) => one.id === op.id);
	if (card === undefined) return { ok: false, why: `no card ${op.id}` };
	if (op.column === "review" && op.reviewer === undefined)
		return { ok: false, why: "a card in review needs its reviewer" };
	if (op.column === "dropped")
		return { ok: false, why: "a card is dropped with a reason, through drop" };
	const at = op.at;
	const next: BoardCard = { ...card, column: op.column, at };
	// A field belongs to a column; leaving it clears it, so the fold is the same whoever wrote.
	if (op.column === "doing") next.now = card.now;
	else delete next.now;
	if (op.column === "review") next.reviewer = op.reviewer;
	else delete next.reviewer;
	if (op.column === "done") next.result = op.result ?? card.result;
	else delete next.result;
	return guarded(
		{ ...board, cards: board.cards.map((one) => (one.id === card.id ? next : one)) },
		writer,
	);
}

function edit(board: Board, op: Extract<BoardOp, { op: "edit" }>): BoardResult {
	const card = board.cards.find((one) => one.id === op.id);
	if (card === undefined) return { ok: false, why: `no card ${op.id}` };
	const title = op.title?.trim();
	if (title !== undefined) {
		const bad = badTitle(title);
		if (bad !== undefined) return { ok: false, why: bad };
	}
	if (op.pr !== undefined && board.cards.some((one) => one.pr === op.pr && one.id !== card.id)) {
		return { ok: false, why: `a card for #${op.pr} already exists` };
	}
	const next: BoardCard = { ...card, at: op.at };
	if (title !== undefined) next.title = title;
	if (op.pr !== undefined) next.pr = op.pr;
	if (op.now !== undefined) next.now = op.now;
	if (op.blocked === null) delete next.blocked;
	else if (op.blocked !== undefined) next.blocked = op.blocked;
	// `now` only means something while the card is being done; the fold enforces it for every writer.
	if (next.column !== "doing") delete next.now;
	return {
		ok: true,
		board: { ...board, cards: board.cards.map((one) => (one.id === card.id ? next : one)) },
	};
}

function drop(board: Board, op: Extract<BoardOp, { op: "drop" }>): BoardResult {
	const card = board.cards.find((one) => one.id === op.id);
	if (card === undefined) return { ok: false, why: `no card ${op.id}` };
	const why = op.why.trim();
	if (why === "") return { ok: false, why: "a dropped card needs its reason" };
	const next: BoardCard = { ...card, column: "dropped", why, at: op.at };
	delete next.now;
	delete next.reviewer;
	delete next.result;
	return {
		ok: true,
		board: { ...board, cards: board.cards.map((one) => (one.id === card.id ? next : one)) },
	};
}

/** A write that would take the board past its limits is refused, whichever operation made it. */
function guarded(next: Board, writer: BoardWriter): BoardResult {
	if (writer === "operator") return { ok: true, board: next };
	const open = next.cards.filter((card) => OPEN_COLUMNS.has(card.column));
	const doing = open.filter((card) => card.column === "doing");
	if (open.length > OPEN) {
		return {
			ok: false,
			why: `the board already has ${open.length} open cards; finish, drop or move one to the backlog: ${open.map((card) => card.id).join(", ")}`,
		};
	}
	if (doing.length > IN_PROGRESS) {
		return {
			ok: false,
			why: `there are already ${IN_PROGRESS} cards in progress; finish one first: ${doing.map((card) => card.id).join(", ")}`,
		};
	}
	return { ok: true, board: next };
}

function badTitle(title: string): string | undefined {
	const words = title.split(/\s+/).filter((word) => word !== "");
	if (title === "" || words.length > TITLE_WORDS)
		return `a title says the result in 1 to ${TITLE_WORDS} words`;
	return undefined;
}

/** The board a session hands to others: the open cards, the backlog as a count, the last three done. */
export function boardView(board: Board): { open: BoardCard[]; backlog: number; done: BoardCard[] } {
	const open = board.cards.filter((card) => OPEN_COLUMNS.has(card.column)).slice(0, OPEN);
	const backlog = board.cards.filter((card) => card.column === "backlog").length;
	const done = board.cards.filter((card) => card.column === "done").slice(-3);
	return { open, backlog, done };
}

/** Searches deliveries and decisions, at most ten at a time. */
export function findBoard(
	board: Board,
	text: string,
): { matches: (BoardCard | BoardDecision)[]; more: number } {
	const needle = text.trim().toLowerCase();
	if (needle === "") return { matches: [], more: 0 };
	const cards = board.cards.filter(
		(card) => card.column === "done" && card.title.toLowerCase().includes(needle),
	);
	const decisions = board.decisions.filter((decision) =>
		decision.text.toLowerCase().includes(needle),
	);
	const all = [...cards, ...decisions];
	return { matches: all.slice(0, TOO_MANY), more: Math.max(0, all.length - TOO_MANY) };
}

/** The one translation of the blocker: the operator reads "you", a third session reads the operator. */
export function blockedText(blocker: BoardBlocker, reader: "operator" | "agent"): string {
	if (blocker.on === "operator") {
		return reader === "operator"
			? `waiting for you: ${blocker.why}`
			: `waiting for the operator: ${blocker.why}`;
	}
	if (blocker.on === "outside") return `waiting outside: ${blocker.why}`;
	return `waiting for ${blocker.handle}: ${blocker.why}`;
}

/** The board is the fold of the session's operations, in the order the log keeps them. */
export function foldBoard(ops: readonly BoardOp[], writer: BoardWriter = "agent"): Board {
	let board = emptyBoard();
	for (const op of ops) {
		const result = applyBoard(board, op, writer);
		if (result.ok) board = result.board;
	}
	return board;
}
