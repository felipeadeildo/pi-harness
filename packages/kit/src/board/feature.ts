// The board feature: on session start the board is the fold of the operations the session's branch
// carries, and readers ask it through the BOARD contract. There is one writer, the board tool, in
// the same process, so an operation needs no merge.
import type { Feature } from "../app/feature.ts";
import { BOARD } from "../contracts/board.ts";
import { boardOf } from "./log.ts";
import { emptyBoard, type Board } from "./model.ts";

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
	},
};
