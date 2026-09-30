import type { Credential } from "@earendil-works/pi-ai";

/** One credential with a name. Pi's own credential is the first account of its provider. */
export interface Account {
	/** Stable id, so renaming an account keeps a session pinned to it. */
	id: string;
	label: string;
	credential: Credential;
}

/** The accounts of one provider, and which one a request uses. */
export interface ProviderAccounts {
	/** The id of the account a request uses. Absent means the first. */
	active?: string;
	accounts: Account[];
}

export interface AccountsFile {
	version: 1;
	providers: Record<string, ProviderAccounts>;
}
