import type { BoardView } from "../board/model.ts";
// One shape per event type. Shapes only grow: a field that changes meaning gets a new name.
import type { AskQuestion, AskResult } from "./ask.ts";
import type { By } from "./by.ts";
import type { CallRuling } from "./calls.ts";
import type { PermissionMode } from "./mode.ts";

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
	"board.changed": { view: BoardView };
	"session.state": { state: RoomActivity };
	/** The text stays in pi's own session file. */
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
	/** Written by the receiving session when it hands the message to its agent. */
	"message.received": { id: string; mode: Delivery };
	"message.read": { id: string };
	"request.bid": { request: string; fit: number; reason: string; idle: boolean };
	/** Written only by the session every other one agrees won. */
	"request.taken": { request: string };
	/** Its name is for people; two rooms may share one. */
	"room.created": { name: string };
	"room.added":
		| {
				member: { folder: string };
				by: "you" | "agent";
				why?: string;
				allowedBy?: string;
				/** A folder brings its sessions in taking part. */
				mode?: never;
		  }
		| {
				member: { session: string; cwd: string };
				by: "you" | "agent";
				why?: string;
				allowedBy?: string;
				mode?: RoomMode;
		  };
	"room.mode": { member: Member; mode: Exclude<RoomMode, "out"> };
	/** A removed session stays out while its folder is in, until added by name again. */
	"room.removed": { member: Member };
	"room.closed": Record<string, never>;
	/** `source` is the feature that asked. */
	"ask.opened": { id: string; source: string; questions: AskQuestion[]; expiresAt?: number };
	/** Without `by`, nobody known closed it. */
	"ask.closed": { id: string; by?: By; result: AskResult };
	/** `by` is the person who answered, when one did. */
	"call.ruled": { toolCallId: string; ruling: CallRuling; by?: By };
	"mode.changed": { mode: PermissionMode };
	/** Logged before the command runs, so a resent id is a repeat across restarts. */
	"command.received": { id: string; command: string; by?: By };
	/** On the id of its `command.received` line. */
	"command.outcome": { id: string; command: string; by?: By; outcome: "refused" | "failed" };
}
