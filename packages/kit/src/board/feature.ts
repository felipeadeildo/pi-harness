// The board is the fold of the branch's operations; the board tool is its only writer.
import type { Feature } from "../app/feature.ts";
import { BOARD } from "../contracts/board.ts";
import { BOARD_OP, boardOf } from "./log.ts";
import { applyBoard, emptyBoard, type Board } from "./model.ts";
import {
	BOARD_DESCRIPTION,
	BOARD_GUIDELINES,
	BOARD_PARAMETERS,
	boardCall,
	boardText,
	type BoardCallParams,
	missingFor,
} from "./tool.ts";

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: value };
}

export const board: Feature = {
	id: "board",
	description: "Keeps the session's board, folded from the operations its log carries",
	setup(scope) {
		let current: Board = emptyBoard();
		BOARD.provide(scope, () => current);
		scope.onSessionStart((ctx) => {
			current = boardOf(ctx.sessionManager.getBranch());
			BOARD.changed(scope, current);
		});
		scope.registerTool<typeof BOARD_PARAMETERS, string>({
			name: "board",
			label: "Board",
			description: BOARD_DESCRIPTION,
			promptGuidelines: BOARD_GUIDELINES,
			parameters: BOARD_PARAMETERS,
			execute: async (_id, params) => {
				const lacking = missingFor(params);
				if (lacking !== undefined) return text(lacking);
				const { unblock, ...rest } = params;
				const op = (
					unblock === true && rest.op === "edit" ? { ...rest, blocked: null } : rest
				) as BoardCallParams;
				if (op.op === "find") {
					const found = boardCall(current, op);
					return text(found.ok ? found.text : found.why);
				}
				const at = Date.now();
				const result = applyBoard(current, { ...op, at }, "agent");
				if (!result.ok) return text(result.why);
				scope.appendEntry(BOARD_OP, { version: 1, op: { ...op, at } });
				current = result.board;
				BOARD.changed(scope, current);
				return text(boardText(current));
			},
		});
	},
};
