import type { Credential } from "@earendil-works/pi-ai";

import type { FailureKind } from "../errors.ts";

/** The id that stands for pi's own credential in the account list. */
export const DEFAULT_ACCOUNT = "default";

/** What pi's own credential is called when there is no account behind it. */
export const DEFAULT_LABEL = "pi default";

/** What an account's last failure was, and until when the plan says it is spent. */
export interface AccountHealth {
	/** The last refusal, kept so the picker can say the account needs a sign-in. */
	lastError?: {
		at: number;
		kind: FailureKind;
		message: string;
	};
	/** The plan is spent until this unix second, when a reading said so. */
	limitedUntil?: number;
}

/** One extra credential with a name. Pi's own credential stays in pi's store, not here. */
export interface Account {
	/** Stable id, so renaming an account keeps a session pinned to it. */
	id: string;
	label: string;
	credential: Credential;
	health?: AccountHealth;
}

/** The extra accounts of one provider, and the one the store prefers. */
export interface ProviderAccounts {
	/** The id of the account the store prefers. Absent means pi's own credential. */
	active?: string;
	accounts: Account[];
}

export type AccountsFile = {
	version: 1;
	providers: Record<string, ProviderAccounts>;
};
