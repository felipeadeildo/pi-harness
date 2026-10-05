// The account a session uses lives in the session file, so a resume or a fork comes back with the
// account it had. The store holds the default; a pin here only overrides it for one branch.
import { isObject } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SESSION_ENTRY } from "./names.ts";

/** The account pinned for a provider. */
export type Pins = Map<string, string>;

export interface PinEntry {
	kind: "account";
	provider: string;
	account: string;
}

/** Pins the account for the rest of the session, and writes it into the session file. */
export function pin(pi: ExtensionAPI, pins: Pins, providerId: string, accountId: string): void {
	pins.set(providerId, accountId);
	pi.appendEntry(SESSION_ENTRY, {
		kind: "account",
		provider: providerId,
		account: accountId,
	} satisfies PinEntry);
}

/** The pins a branch recorded, newest winning. */
export function replay(branch: readonly unknown[]): Pins {
	const pins: Pins = new Map();
	for (const item of branch) {
		if (!isObject(item) || item.type !== "custom" || item.customType !== SESSION_ENTRY) continue;
		const data = item.data;
		if (!isObject(data) || typeof data.provider !== "string") continue;
		if (data.kind === "account" && typeof data.account === "string") {
			pins.set(data.provider, data.account);
		} else {
			// Older sessions pinned pi's own credential, which is no account any more: the session goes
			// back to the store's choice.
			pins.delete(data.provider);
		}
	}
	return pins;
}
