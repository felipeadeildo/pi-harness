import type { Credential } from "@earendil-works/pi-ai";

import type { FailureKind } from "../errors.ts";

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

/** One credential with a name. A provider with accounts serves every request from one of them. */
export interface Account {
	/** Stable id, so renaming an account keeps a session pinned to it. */
	id: string;
	label: string;
	credential: Credential;
	health?: AccountHealth;
}

/** The accounts of one provider, and the one a new session starts on. */
export interface ProviderAccounts {
	/** The id of the account the store prefers. Absent means the first one. */
	active?: string;
	accounts: Account[];
}

export type AccountsFile = {
	version: 1;
	providers: Record<string, ProviderAccounts>;
};
