// One file beside the settings for every provider's accounts. Pi's own credential stays in pi's store.
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { globalSettingsPath, isObject, readSettingsFile, writeSettingsFile } from "@adeildo/pi-kit";
import type { Credential } from "@earendil-works/pi-ai";

import { FAILURE_KINDS, type FailureKind } from "../errors.ts";
import { reason } from "./describe.ts";
import type { Account, AccountHealth, AccountsFile, ProviderAccounts } from "./types.ts";

const ACCOUNTS_FILE = "accounts.json";

export function accountsPath(): string {
	return join(dirname(globalSettingsPath()), ACCOUNTS_FILE);
}

/** Taken by two pi processes refreshing the same accounts. */
export function accountsLockPath(): string {
	return join(dirname(globalSettingsPath()), "accounts.lock");
}

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

	reload(): string[] {
		const read = readAccounts(this.path);
		this.data = { version: 1, providers: read.providers };
		return read.warnings;
	}

	providerIds(): string[] {
		return Object.keys(this.file().providers);
	}

	accounts(providerId: string): Account[] {
		return this.file().providers[providerId]?.accounts ?? [];
	}

	has(providerId: string): boolean {
		return this.accounts(providerId).length > 0;
	}

	/** Without one the feature keeps pi's own credential. */
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
			const account = find(providers, providerId, id);
			if (account !== undefined) account.label = label.trim() || account.label;
		});
	}

	setActive(providerId: string, id: string | undefined): string | undefined {
		return this.edit((providers) => {
			const entry = providers[providerId];
			if (entry === undefined) return;
			if (id === undefined) delete entry.active;
			else if (entry.accounts.some((account) => account.id === id)) entry.active = id;
		});
	}

	setCredential(providerId: string, id: string, credential: Credential): string | undefined {
		return this.edit((providers) => {
			const account = find(providers, providerId, id);
			if (account !== undefined) account.credential = credential;
		});
	}

	markError(
		providerId: string,
		id: string,
		kind: FailureKind,
		message: string,
	): string | undefined {
		return this.editHealth(providerId, id, (health) => {
			health.lastError = { at: Date.now(), kind, message };
		});
	}

	clearError(providerId: string, id: string): string | undefined {
		return this.editHealth(providerId, id, (health) => {
			delete health.lastError;
		});
	}

	markLimited(providerId: string, id: string, until: number | undefined): string | undefined {
		return this.editHealth(providerId, id, (health) => {
			if (until === undefined) delete health.limitedUntil;
			else health.limitedUntil = until;
		});
	}

	private editHealth(
		providerId: string,
		id: string,
		change: (health: AccountHealth) => void,
	): string | undefined {
		return this.edit((providers) => {
			const account = find(providers, providerId, id);
			if (account === undefined) return;
			const health = account.health ?? {};
			change(health);
			if (health.lastError === undefined && health.limitedUntil === undefined)
				delete account.health;
			else account.health = health;
		});
	}

	private file(): AccountsFile {
		if (this.data === undefined) this.reload();
		return this.data ?? { version: 1, providers: {} };
	}

	/** Reads, changes and writes, so another pi's write is not lost. */
	private edit(change: (providers: Record<string, ProviderAccounts>) => void): string | undefined {
		const read = readAccounts(this.path);
		const warning = read.warnings[0];
		if (warning !== undefined) return warning;
		change(read.providers);
		this.data = { version: 1, providers: read.providers };
		return writeAccounts(this.path, this.data);
	}
}

function find(
	providers: Record<string, ProviderAccounts>,
	providerId: string,
	id: string,
): Account | undefined {
	return providers[providerId]?.accounts.find((account) => account.id === id);
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
		const accounts = value.accounts
			.map(asAccount)
			.filter((account): account is Account => account !== undefined);
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

function asAccount(input: unknown): Account | undefined {
	if (!isObject(input)) return undefined;
	if (
		typeof input.id !== "string" ||
		typeof input.label !== "string" ||
		!isCredential(input.credential)
	) {
		return undefined;
	}
	const health = readHealth(input.health);
	return {
		id: input.id,
		label: input.label,
		credential: input.credential,
		...(health === undefined ? {} : { health }),
	};
}

/** So a hand edit cannot break the account. */
function readHealth(input: unknown): AccountHealth | undefined {
	if (!isObject(input)) return undefined;
	const health: AccountHealth = {};
	const error = input.lastError;
	if (
		isObject(error) &&
		typeof error.at === "number" &&
		isFailureKind(error.kind) &&
		typeof error.message === "string"
	) {
		health.lastError = { at: error.at, kind: error.kind, message: error.message };
	}
	if (typeof input.limitedUntil === "number") health.limitedUntil = input.limitedUntil;
	return health.lastError === undefined && health.limitedUntil === undefined ? undefined : health;
}

function isFailureKind(value: unknown): value is FailureKind {
	return typeof value === "string" && (FAILURE_KINDS as readonly string[]).includes(value);
}

function isCredential(input: unknown): input is Credential {
	if (!isObject(input)) return false;
	if (input.type === "oauth")
		return typeof input.access === "string" && typeof input.refresh === "string";
	if (input.type === "api_key") return input.key === undefined || typeof input.key === "string";
	return false;
}
