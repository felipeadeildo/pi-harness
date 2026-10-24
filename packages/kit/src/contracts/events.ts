// The events the harness writes, one shape per type. A viewer reads these and nothing else, so a
// shape only grows: a field that changes meaning gets a new name, and a new version of the log
// would get a new `v`.
import type { SessionTasks } from "../tasks/state.ts";
import type { AskQuestion, AskResult } from "./ask.ts";
import type { By } from "./by.ts";
import type { CallRuling } from "./calls.ts";
import type { PermissionMode } from "./mode.ts";

export type SessionState = "running" | "idle";

/** How a message reached the agent it was for. */
export type Delivery = "woke" | "after-run" | "steered" | "next-turn";

export type Activity =
	| { kind: "edited"; path: string }
	| { kind: "ran"; command: string; ok: boolean }
	| { kind: "committed"; sha: string; subject: string };

/**
 * Who a shared room counts: every session opened in a folder, now and later, or one session. A
 * folder is an absolute path with symlinks resolved.
 */
export type Member = { folder: string } | { session: string; cwd: string };

export interface LogEventMap {
	/**
	 * A session opened in the folder, or joined a shared room. It is live while its process is. `cwd`
	 * is where it works, so a room with sessions from several folders can say whose path is whose.
	 * `start` tells its process from a later one that got the same pid.
	 */
	"session.started": { pid: number; host: string; model?: string; cwd?: string; start?: string };
	"session.ended": Record<string, never>;
	/**
	 * The short name others mention it by, and the title it took it from. The names feature logs the
	 * handle and the tasks feature logs the title, so a reader merges the two instead of letting the
	 * last event erase the other field.
	 */
	"session.named": { handle?: string; title?: string };
	"session.state": { state: SessionState };
	/** You sent a prompt in this session. What you said stays in pi's own session file. */
	"session.prompted": Record<string, never>;
	/**
	 * A prompt arrived from somewhere other than this terminal, such as a client. Who sent it is the
	 * whole fact: what they said is in pi's own session file, as it is for a prompt typed here.
	 */
	"prompt.received": { by?: By };
	"tasks.changed": { state: SessionTasks };
	/**
	 * What a shared room carries of a session's tasks: the part the board shows, which is what is
	 * doing, waiting and queued, and the last few done. The whole snapshot stays in the folder's room.
	 */
	"tasks.board": { state: SessionTasks };
	activity: Activity;
	/**
	 * A message in the folder's room. `to` lists session ids, "all" for every session (`@everyone`),
	 * or "any" for a request the one that fits it best takes (`@anyone`). `from: "you"` only comes
	 * from what you typed in that session.
	 */
	"message.posted": {
		id: string;
		from: "you" | "agent";
		to: string[] | "all" | "any";
		text: string;
		urgent?: boolean;
		/**
		 * The depth of the run that wrote it: 0 when someone at a keyboard started that run, and d + 1
		 * when an agent message of depth d woke it. A message from you is always 0. A message of depth 4
		 * or more no longer wakes anyone.
		 */
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
	/**
	 * Someone joins the room: you, or an agent whose call the permission gate let through. `why` is
	 * what the agent said it needs, and `allowedBy` what let the call through.
	 */
	"room.added": { member: Member; by: "you" | "agent"; why?: string; allowedBy?: string };
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
	/**
	 * A command a client sent for this session, logged before it runs so a resent id is a repeat even
	 * across a restart. A command that did run writes only this line, so its absence from
	 * `command.outcome` is what running looks like.
	 */
	"command.received": { id: string; command: string; by?: By };
	/** How a command that did not run ended, on the id of its `command.received` line. */
	"command.outcome": { id: string; command: string; by?: By; outcome: "refused" | "failed" };
}
