// The accounts live beside the settings, one file for every provider. Pi's own credential is the
// first account of its provider, and the others come from the provider's login, so no OAuth here.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { globalSettingsPath, isObject } from "@adeildo/pi-kit";
import type { Credential } from "@earendil-works/pi-ai";

import type { Account, AccountsFile, ProviderAccounts } from "./types.ts";

export const ACCOUNTS_FILE = "accounts.json";

export function accountsPath(): string {
	return join(dirname(globalSettingsPath()), ACCOUNTS_FILE);
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

	/**
	 * The account the store uses, when one is set. Without a choice the feature keeps pi's own
	 * credential, so adding an account never takes over a session by itself.
	 */
	active(providerId: string): Account | undefined {
		const entry = this.file().providers[providerId];
		if (entry?.active === undefined) return undefined;
		return entry.accounts.find((account) => account.id === entry.active);
	}

	/** Returns why it was not saved. */
	add(providerId: string, label: string, credential: Credential): string | undefined {
		return this.edit((providers) => {
			const entry = providers[providerId] ?? { accounts: [] };
			entry.accounts.push({ id: randomUUID(), label: label.trim() || providerId, credential });
			providers[providerId] = entry;
		});
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

	/** Pins the account a request uses, or clears the pin with undefined. */
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
	if (!existsSync(path)) return { providers: {}, warnings: [] };

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { providers: {}, warnings: [`could not parse ${path}: ${reason(error)}`] };
	}
	if (!isObject(raw)) return { providers: {}, warnings: [`${path} must contain a JSON object`] };
	if (!isObject(raw.providers)) return { providers: {}, warnings: [] };

	const providers: Record<string, ProviderAccounts> = {};
	for (const [providerId, value] of Object.entries(raw.providers)) {
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
		mkdirSync(dirname(path), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(data, null, "\t")}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, path);
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

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
