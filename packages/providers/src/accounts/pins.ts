// The account in use lives in the session file, so a resume or a fork keeps it. The store holds the default.
import { isObject } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SESSION_CHANGES } from "./names.ts";

export type Pins = Map<string, string>;

interface PinEntry {
	kind: "account";
	provider: string;
	account: string;
}

export function pin(pi: ExtensionAPI, pins: Pins, providerId: string, accountId: string): void {
	pins.set(providerId, accountId);
	pi.appendEntry(SESSION_CHANGES, {
		kind: "account",
		provider: providerId,
		account: accountId,
	} satisfies PinEntry);
}

export function replay(branch: readonly unknown[]): Pins {
	const pins: Pins = new Map();
	for (const item of branch) {
		if (!isObject(item) || item.type !== "custom" || item.customType !== SESSION_CHANGES) continue;
		const data = item.data;
		if (!isObject(data) || typeof data.provider !== "string") continue;
		if (data.kind === "account" && typeof data.account === "string") {
			pins.set(data.provider, data.account);
		} else {
			// A pin of pi's own credential is not an account: back to the store's choice.
			pins.delete(data.provider);
		}
	}
	return pins;
}
