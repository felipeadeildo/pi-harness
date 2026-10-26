import type { BoardView } from "../board/model.ts";
// One shape per event type. Shapes only grow: a field that changes meaning gets a new name.
import type { AskQuestion, AskResult } from "./ask.ts";
import type { By } from "./by.ts";
import type { CallRuling } from "./calls.ts";
import type { PermissionMode } from "./mode.ts";

/** The value of `session.state`. */
export type RoomActivity = "running" | "idle";

export type Delivery = "woke" | "after-run" | "steered" | "next-turn";

export type Activity =
	| { kind: "edited"; path: string }
	| { kind: "ran"; command: string; ok: boolean }
	| { kind: "committed"; sha: string; subject: string };

/** `folder` is absolute with symlinks resolved. */
export type Member = { folder: string } | { session: string; cwd: string };

/** `listening` hears only what names it. `@everyone` and `@anyone` reach only `in`. */
export type RoomMode = "in" | "listening" | "out";

export interface LogEventMap {
	/** `start` tells this process from a later one with the same pid. */
	"session.started": { pid: number; host: string; model?: string; cwd?: string; start?: string };
	"session.ended": Record<string, never>;
	"session.named": { handle?: string };
	/** What a session's board holds, as the sessions that read it draw it. */
	"board.changed": { view: BoardView };
	"session.state": { state: RoomActivity };
	/** You sent a prompt in this session. What you said stays in pi's own session file. */
	"session.prompted": Record<string, never>;
	/** A prompt from somewhere other than the terminal; its text is in pi's session file. */
	"prompt.received": { by: By };
	activity: Activity;
	/** `to` is session ids, "all" (`@everyone`) or "any" (`@anyone`). */
	"message.posted": {
		id: string;
		from: "you" | "agent";
		to: string[] | "all" | "any";
		text: string;
		urgent?: boolean;
		/** 0 when a person started the run, d + 1 when a message of depth d woke it. Depth 4 wakes no one. */
		depth?: number;
	};
	/** Written by the session the message was for, when it handed it to its agent. */
	"message.received": { id: string; mode: Delivery };
	/** The agent's model read it. */
	"message.read": { id: string };
	/** A session's offer to take a request to everyone. */
	"request.bid": { request: string; fit: number; reason: string; idle: boolean };
	/** Written only by the session every other one agrees won the request. */
	"request.taken": { request: string };
	/** A shared room begins. Its name is for people; two rooms may share one. */
	"room.created": { name: string };
	"room.added":
		| {
				member: { folder: string };
				by: "you" | "agent";
				why?: string;
				allowedBy?: string;
				/** A folder has no mode: it brings its sessions in taking part. */
				mode?: never;
		  }
		| {
				member: { session: string; cwd: string };
				by: "you" | "agent";
				why?: string;
				allowedBy?: string;
				/** How the member joins: `in` takes part, `listening` hears only what names it. */
				mode?: RoomMode;
		  };
	"room.mode": { member: Member; mode: Exclude<RoomMode, "out"> };
	/** A removed session stays out even while its folder is in, until it is added by name again. */
	"room.removed": { member: Member };
	/** Nobody joins any more, and every member leaves. */
	"room.closed": Record<string, never>;
	/** A question went out through `harness:ask`. `source` is the feature that asked. */
	"ask.opened": { id: string; source: string; questions: AskQuestion[]; expiresAt?: number };
	/** It closed, with who answered, or who gave up on it. Without `by`, nobody known did. */
	"ask.closed": { id: string; by?: By; result: AskResult };
	/** What decided a tool call. `by` is the person who answered, when one did. */
	"call.ruled": { toolCallId: string; ruling: CallRuling; by?: By };
	"mode.changed": { mode: PermissionMode };
	/** Logged before the command runs, so a resent id is a repeat across restarts. */
	"command.received": { id: string; command: string; by?: By };
	/** How a command that did not run ended, on the id of its `command.received` line. */
	"command.outcome": { id: string; command: string; by?: By; outcome: "refused" | "failed" };
}
