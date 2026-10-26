import type { Credential } from "@earendil-works/pi-ai";

import type { FailureKind } from "../errors.ts";

export interface AccountHealth {
	lastError?: {
		at: number;
		kind: FailureKind;
		message: string;
	};
	/** A unix second, when a reading said so. */
	limitedUntil?: number;
}

export interface Account {
	/** So renaming keeps a session pinned to it. */
	id: string;
	label: string;
	credential: Credential;
	health?: AccountHealth;
}

export interface ProviderAccounts {
	/** Absent means the first one. */
	active?: string;
	accounts: Account[];
}

export type AccountsFile = {
	version: 1;
	providers: Record<string, ProviderAccounts>;
};
