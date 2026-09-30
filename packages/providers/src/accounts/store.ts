// The extra accounts live beside the settings, one file for every provider. Pi's own credential is
// not copied here: it stays in pi's store, and is what a request uses when no account is chosen.
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { globalSettingsPath, isObject, readSettingsFile, writeSettingsFile } from "@adeildo/pi-kit";
import type { Credential } from "@earendil-works/pi-ai";

import { reason } from "./describe.ts";
import type { Account, AccountsFile, ProviderAccounts } from "./types.ts";

export const ACCOUNTS_FILE = "accounts.json";

export function accountsPath(): string {
	return join(dirname(globalSettingsPath()), ACCOUNTS_FILE);
}

/** What an add produced: the account it wrote, or why it did not. */
export interface Added {
	account?: Account;
	problem?: string;
}

export class AccountStore {
	private readonly path: string;
	private data: AccountsFile | undefined;

	constructor(path: string = accountsPath()) {
		this.path = path;
	}

	/** Reads the file again, for another pi's write or a hand edit. */
	reload(): string[] {
		const read = readAccounts(this.path);
		this.data = { version: 1, providers: read.providers };
		return read.warnings;
	}

	/** The providers with at least one account. */
	providerIds(): string[] {
		return Object.keys(this.file().providers);
	}

	accounts(providerId: string): Account[] {
		return this.file().providers[providerId]?.accounts ?? [];
	}

	has(providerId: string): boolean {
		return this.accounts(providerId).length > 0;
	}

	/** The account the store prefers. Without one the feature keeps pi's own credential. */
	active(providerId: string): Account | undefined {
		const entry = this.file().providers[providerId];
		if (entry?.active === undefined) return undefined;
		return entry.accounts.find((account) => account.id === entry.active);
	}

	add(providerId: string, label: string, credential: Credential): Added {
		const account: Account = { id: randomUUID(), label: label.trim() || providerId, credential };
		const problem = this.edit((providers) => {
			const entry = providers[providerId] ?? { accounts: [] };
			entry.accounts.push(account);
			providers[providerId] = entry;
		});
		return problem === undefined ? { account } : { problem };
	}

	remove(providerId: string, id: string): string | undefined {
		return this.edit((providers) => {
			const entry = providers[providerId];
			if (entry === undefined) return;
			entry.accounts = entry.accounts.filter((account) => account.id !== id);
			if (entry.active === id) delete entry.active;
			if (entry.accounts.length === 0) delete providers[providerId];
		});
	}

	rename(providerId: string, id: string, label: string): string | undefined {
		return this.edit((providers) => {
			const account = providers[providerId]?.accounts.find((entry) => entry.id === id);
			if (account !== undefined) account.label = label.trim() || account.label;
		});
	}

	/** Sets the account the store prefers, or clears the choice with undefined. */
	setActive(providerId: string, id: string | undefined): string | undefined {
		return this.edit((providers) => {
			const entry = providers[providerId];
			if (entry === undefined) return;
			if (id === undefined) delete entry.active;
			else if (entry.accounts.some((account) => account.id === id)) entry.active = id;
		});
	}

	/** Keeps the credential a refresh produced. */
	setCredential(providerId: string, id: string, credential: Credential): string | undefined {
		return this.edit((providers) => {
			const account = providers[providerId]?.accounts.find((entry) => entry.id === id);
			if (account !== undefined) account.credential = credential;
		});
	}

	private file(): AccountsFile {
		if (this.data === undefined) this.reload();
		return this.data ?? { version: 1, providers: {} };
	}

	/** Reads, changes and writes, so another pi's write since the last read is not lost. */
	private edit(change: (providers: Record<string, ProviderAccounts>) => void): string | undefined {
		const read = readAccounts(this.path);
		const warning = read.warnings[0];
		if (warning !== undefined) return warning;
		change(read.providers);
		this.data = { version: 1, providers: read.providers };
		return writeAccounts(this.path, this.data);
	}
}

function readAccounts(path: string): {
	providers: Record<string, ProviderAccounts>;
	warnings: string[];
} {
	const file = readSettingsFile(path);
	if (file.warnings.length > 0) return { providers: {}, warnings: file.warnings };

	const source = file.data.providers;
	if (!isObject(source)) return { providers: {}, warnings: [] };

	const providers: Record<string, ProviderAccounts> = {};
	for (const [providerId, value] of Object.entries(source)) {
		if (!isObject(value) || !Array.isArray(value.accounts)) continue;
		const accounts = value.accounts.filter(isAccount);
		if (accounts.length === 0) continue;
		providers[providerId] = {
			accounts,
			...(typeof value.active === "string" ? { active: value.active } : {}),
		};
	}
	return { providers, warnings: [] };
}

function writeAccounts(path: string, data: AccountsFile): string | undefined {
	try {
		writeSettingsFile(path, data, { mode: 0o600 });
		return undefined;
	} catch (error) {
		return reason(error);
	}
}

function isAccount(input: unknown): input is Account {
	return (
		isObject(input) &&
		typeof input.id === "string" &&
		typeof input.label === "string" &&
		isCredential(input.credential)
	);
}

function isCredential(input: unknown): input is Credential {
	if (!isObject(input)) return false;
	if (input.type === "oauth")
		return typeof input.access === "string" && typeof input.refresh === "string";
	if (input.type === "api_key") return input.key === undefined || typeof input.key === "string";
	return false;
}
