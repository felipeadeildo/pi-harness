// The account a session uses lives in the session file, so a resume or a fork comes back with the
// account it had. The store holds the default; a pin here only overrides it for one branch.
import { isObject } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SESSION_ENTRY = "pi-providers:accounts";

/** The account pinned for a provider. `null` means the credential pi itself has. */
export type Pins = Map<string, string | null>;

export type PinEntry =
	| { kind: "account"; provider: string; account: string }
	| { kind: "default"; provider: string };

export function record(pi: ExtensionAPI, entry: PinEntry): void {
	pi.appendEntry(SESSION_ENTRY, entry);
}

/** Pins the account for the rest of the session, and writes it into the session file. */
export function pin(
	pi: ExtensionAPI,
	pins: Pins,
	providerId: string,
	accountId: string | null,
): void {
	pins.set(providerId, accountId);
	record(
		pi,
		accountId === null
			? { kind: "default", provider: providerId }
			: { kind: "account", provider: providerId, account: accountId },
	);
}

/** The pins a branch recorded, newest winning. */
export function replay(branch: readonly unknown[]): Pins {
	const pins: Pins = new Map();
	for (const item of branch) {
		const entry = pinEntry(item);
		if (entry === undefined) continue;
		if (entry.kind === "default") pins.set(entry.provider, null);
		else pins.set(entry.provider, entry.account);
	}
	return pins;
}

function pinEntry(item: unknown): PinEntry | undefined {
	if (!isObject(item) || item.type !== "custom" || item.customType !== SESSION_ENTRY)
		return undefined;
	const data = item.data;
	if (!isObject(data)) return undefined;
	const provider = typeof data.provider === "string" ? data.provider : undefined;
	if (provider === undefined) return undefined;
	if (data.kind === "default") return { kind: "default", provider };
	if (data.kind === "account" && typeof data.account === "string")
		return { kind: "account", provider, account: data.account };
	return undefined;
}
