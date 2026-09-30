import type { Credential } from "@earendil-works/pi-ai";

/** One extra credential with a name. Pi's own credential stays in pi's store, not here. */
export interface Account {
	/** Stable id, so renaming an account keeps a session pinned to it. */
	id: string;
	label: string;
	credential: Credential;
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
