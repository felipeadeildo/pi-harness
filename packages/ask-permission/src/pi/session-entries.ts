// In the session file, so a resume or a fork comes back with its mode, outside and always yes.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isOutsideScope, type OutsideScope } from "#core/config/schema.ts";
import { parseMode, type PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";
import type { SessionState } from "#pi/session.ts";
import { isRecord } from "#util/primitives.ts";

export const SESSION_ENTRY = `${NAME}:session`;

export type SessionEntry =
	| { kind: "mode"; mode: PermissionMode }
	| { kind: "outside"; outside: OutsideScope }
	| { kind: "always-yes"; toolName: string; level: string }
	| { kind: "forget-always-yes" };

export interface SessionSnapshot {
	mode: PermissionMode;
	outside: OutsideScope;
	alwaysYes: { toolName: string; level: string }[];
}

export function record(pi: ExtensionAPI, entry: SessionEntry): void {
	pi.appendEntry(SESSION_ENTRY, entry);
}

export function replay(
	branch: readonly unknown[],
	start: Pick<SessionSnapshot, "mode" | "outside">,
): SessionSnapshot {
	const snapshot: SessionSnapshot = { ...start, alwaysYes: [] };

	for (const item of branch) {
		const entry = sessionEntry(item);
		switch (entry?.kind) {
			case "mode":
				snapshot.mode = entry.mode;
				break;
			case "outside":
				snapshot.outside = entry.outside;
				break;
			case "always-yes":
				snapshot.alwaysYes.push({ toolName: entry.toolName, level: entry.level });
				break;
			case "forget-always-yes":
				snapshot.alwaysYes = [];
				break;
		}
	}
	return snapshot;
}

export function restoreSession(state: SessionState, ctx: ExtensionContext): void {
	const snapshot = replay(ctx.sessionManager.getBranch(), {
		mode: state.config.mode,
		outside: state.config.workspace.outside,
	});

	state.mode = snapshot.mode;
	state.outside = snapshot.outside;
	state.alwaysYes.forget("session");
	for (const { toolName, level } of snapshot.alwaysYes) {
		state.alwaysYes.add("session", toolName, level);
	}
}

function sessionEntry(item: unknown): SessionEntry | undefined {
	if (!isRecord(item) || item.type !== "custom" || item.customType !== SESSION_ENTRY) {
		return undefined;
	}

	const data = item.data;
	if (!isRecord(data)) return undefined;

	if (data.kind === "mode") {
		const mode = typeof data.mode === "string" ? parseMode(data.mode) : undefined;
		return mode === undefined ? undefined : { kind: "mode", mode };
	}
	if (data.kind === "outside" && isOutsideScope(data.outside)) {
		return { kind: "outside", outside: data.outside };
	}
	if (data.kind === "always-yes" && isText(data.toolName) && isText(data.level)) {
		return { kind: "always-yes", toolName: data.toolName, level: data.level };
	}
	if (data.kind === "forget-always-yes") return { kind: "forget-always-yes" };
	return undefined;
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}
