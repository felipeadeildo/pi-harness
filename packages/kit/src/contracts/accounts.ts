// What the accounts feature knows about the account in use. Whoever draws it asks while drawing, so
// the answer is never a frame behind.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ACCOUNT_STATE = "harness:accounts:state";

export interface AccountWindow {
	name: string;
	/** Percent used of that window, 0..100. */
	used: number;
	/** Time left in the window, like `11m`. */
	resetsIn?: string;
}

export interface AccountState {
	provider: string;
	label: string;
	windows: AccountWindow[];
	/** The provider refused the account's credential, so it needs a sign-in. */
	needsLogin?: boolean;
}

interface Request {
	provider: string;
	state?: AccountState;
}

type Events = ExtensionAPI["events"];

/** The account in use for a provider, or undefined when the provider has no accounts. */
export function accountStateOf(
	events: Events,
	provider: string | undefined,
): AccountState | undefined {
	if (provider === undefined) return undefined;
	const request: Request = { provider };
	events.emit(ACCOUNT_STATE, request);
	return request.state;
}
