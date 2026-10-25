// The board a session keeps, folded from its operations. It is offered whole, because every reader
// (the panel, the peers view and a third session's prompt) needs the same state.
import { isBoard, type Board } from "../board/model.ts";
import { defineContract } from "../contract.ts";
import { guarded } from "../decode.ts";

export const BOARD = defineContract<Board>("board", guarded(isBoard, "a board"));
