// This pi's own session as a source. Pi only appends entries, so each follower reads past what it saw.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SessionSummary, SessionSource, SourceItem } from "../contracts/sources.ts";
import { HOST } from "../events/log.ts";

interface Follower {
	on: (item: SourceItem) => void;
	after: string | undefined;
	seen: number | undefined;
	sent: string | undefined;
}

/** Made while the extension loads, like any `pi.on`. */
export function piSource(pi: Pick<ExtensionAPI, "on">): SessionSource {
	let ctx: ExtensionContext | undefined;
	let pending = false;
	let ended = false;
	let turn: ReturnType<typeof setTimeout> | undefined;
	const followers = new Set<Follower>();

	function finish(): void {
		clearTimeout(turn);
		turn = undefined;
		pending = false;
		ctx = undefined;
		ended = true;
		for (const follower of followers) follower.on({ kind: "ended" });
		followers.clear();
	}

	/** Pi's refusal is the only notice of a replaced or reloaded context on some hosts. */
	function read(follower: Follower, current: ExtensionContext): void {
		try {
			catchUp(follower, current);
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("stale")) throw error;
			finish();
		}
	}

	function catchUp(follower: Follower, current: ExtensionContext): void {
		const entries = current.sessionManager.getEntries();
		if (follower.seen === undefined) {
			const at =
				follower.after === undefined ? -1 : entries.findIndex((e) => e.id === follower.after);
			if (follower.after !== undefined && at === -1) follower.on({ kind: "reset" });
			follower.seen = at + 1;
		}
		for (const entry of entries.slice(follower.seen)) follower.on({ kind: "entry", entry });
		follower.seen = entries.length;
		const summary = snapshotOf(current);
		const text = JSON.stringify(summary);
		if (text === follower.sent) return;
		follower.sent = text;
		follower.on({ kind: "summary", summary });
	}

	function changed(next: ExtensionContext): void {
		// Pi still fires some events after the session ended, with a context it no longer owns.
		if (ended) return;
		ctx = next;
		// Pi tells extensions of `message_end` before it writes the entry.
		if (pending) return;
		pending = true;
		turn = setTimeout(() => {
			pending = false;
			turn = undefined;
			if (ctx === undefined) return;
			for (const follower of followers) read(follower, ctx);
		}, 0);
	}

	pi.on("session_start", (_event, next) => {
		ended = false;
		changed(next);
	});
	pi.on("session_info_changed", (_event, next) => changed(next));
	pi.on("session_compact", (_event, next) => changed(next));
	pi.on("session_tree", (_event, next) => changed(next));
	pi.on("model_select", (_event, next) => changed(next));
	pi.on("thinking_level_select", (_event, next) => changed(next));
	pi.on("message_end", (_event, next) => changed(next));
	pi.on("turn_end", (_event, next) => changed(next));
	pi.on("session_shutdown", finish);

	return {
		open() {
			if (ctx === undefined) return Promise.reject(new Error("the session has not started"));
			return Promise.resolve(snapshotOf(ctx));
		},
		follow(after, on) {
			// A late caller, such as a bridge reconnecting during `/new`, hears the end too.
			if (ended) {
				on({ kind: "ended" });
				return () => {};
			}
			// A cursor with nothing this source reads, such as a newer one, is unknown.
			if (after !== undefined && after.entry === undefined) on({ kind: "reset" });
			const follower: Follower = { on, after: after?.entry, seen: undefined, sent: undefined };
			followers.add(follower);
			if (ctx !== undefined) read(follower, ctx);
			return () => followers.delete(follower);
		},
	};
}

function snapshotOf(ctx: ExtensionContext): SessionSummary {
	const session = ctx.sessionManager;
	const usage = ctx.getContextUsage();
	return {
		session: session.getSessionId(),
		machine: HOST,
		cwd: ctx.cwd,
		name: session.getSessionName(),
		leafId: session.getLeafId() ?? undefined,
		model: ctx.model === undefined ? undefined : { provider: ctx.model.provider, id: ctx.model.id },
		thinkingLevel: ctx.thinkingLevel,
		context:
			usage === undefined || usage.tokens === null
				? undefined
				: { tokens: usage.tokens, window: usage.contextWindow },
	};
}
