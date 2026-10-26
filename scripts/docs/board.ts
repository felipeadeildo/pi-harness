// The board's picture, built by folding the operations the agent sends with the board tool, so it
// shows what the panel draws and not a hand-made mockup.
import type { Theme } from "@earendil-works/pi-coding-agent";

import { BoardPanel } from "../../packages/kit/src/board/board-panel.ts";
import { type BoardOp, foldBoard } from "../../packages/kit/src/index.ts";
import { WIDTH } from "./drive.ts";

/** 14:00 on the clock the pictures read. */
const at = Date.UTC(2026, 9, 8, 14, 0);

/** The session the Alt+T picture shows: OAuth on an MCP server, with one card waiting on you. */
const SESSION: BoardOp[] = [
	{ op: "add", title: "Expose OAuth instead of an API key", at },
	{ op: "move", id: "c1", column: "done", result: "the Workers OAuth provider", at },
	{ op: "add", title: "One secret with an auth mode", column: "doing", pr: 41, at },
	{ op: "edit", id: "c2", now: "53 tests pass, writing the README", at },
	{ op: "add", title: "Show loading while history arrives", at },
	{ op: "move", id: "c3", column: "review", reviewer: "badger", at },
	{
		op: "add",
		title: "Push the fix to main",
		at,
		blocked: { on: "operator", why: "production has no SECRET yet" },
	},
	{ op: "add", title: "Write the 1.0.0 release notes", column: "backlog", at },
	{ op: "decide", text: "One SECRET with a mode: API_KEY, OAUTH or BOTH", at },
];

/** `Alt+T` open over the chat. */
export function boardPanel(theme: Theme): string[] {
	const board = foldBoard(SESSION);
	return new BoardPanel({
		theme,
		close: () => {},
		requestRender: () => {},
		read: () => board,
	}).render(WIDTH);
}
