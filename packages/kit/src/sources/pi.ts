// This pi's own session as a source, for whoever publishes it, such as remote's bridge. Pi appends
// entries only, so each follower keeps how many it has seen and reads the rest after each event that
// may have added one.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SessionSnapshot, SessionSource, SourceItem } from "../contracts/sources.ts";
import { HOST } from "../events/log.ts";

interface Follower {
	on: (item: SourceItem) => void;
	after: string | undefined;
	/** How many entries it has, or undefined until its cursor is found. */
	seen: number | undefined;
	sent: string | undefined;
}

/**
 * Registers its handlers on `pi`, so it is made while the extension loads, like any `pi.on`. Its
 * followers end with the session, because pi makes a new extension runtime for the next one.
 */
export function piSource(pi: Pick<ExtensionAPI, "on">): SessionSource {
	let ctx: ExtensionContext | undefined;
	let pending = false;
	const followers = new Set<Follower>();

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
		const snapshot = snapshotOf(current);
		const text = JSON.stringify(snapshot);
		if (text === follower.sent) return;
		follower.sent = text;
		follower.on({ kind: "snapshot", snapshot });
	}

	function changed(next: ExtensionContext): void {
		ctx = next;
		// Pi tells extensions of `message_end` before it writes the entry.
		if (pending) return;
		pending = true;
		setTimeout(() => {
			pending = false;
			if (ctx === undefined) return;
			for (const follower of followers) catchUp(follower, ctx);
		}, 0);
	}

	// Each one may have appended an entry or changed the snapshot.
	pi.on("session_start", (_event, next) => changed(next));
	pi.on("session_info_changed", (_event, next) => changed(next));
	pi.on("session_compact", (_event, next) => changed(next));
	pi.on("session_tree", (_event, next) => changed(next));
	pi.on("model_select", (_event, next) => changed(next));
	pi.on("thinking_level_select", (_event, next) => changed(next));
	pi.on("message_end", (_event, next) => changed(next));
	pi.on("turn_end", (_event, next) => changed(next));
	pi.on("session_shutdown", () => {
		ctx = undefined;
		for (const follower of followers) follower.on({ kind: "ended" });
		followers.clear();
	});

	return {
		snapshot() {
			if (ctx === undefined) return Promise.reject(new Error("the session has not started"));
			return Promise.resolve(snapshotOf(ctx));
		},
		follow(after, on) {
			const follower: Follower = { on, after: after?.entry, seen: undefined, sent: undefined };
			followers.add(follower);
			if (ctx !== undefined) catchUp(follower, ctx);
			return () => followers.delete(follower);
		},
	};
}

function snapshotOf(ctx: ExtensionContext): SessionSnapshot {
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
