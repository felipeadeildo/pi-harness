import type {
	AuthType,
	Credential,
	Provider,
	ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

import type { Account } from "./types.ts";

/** The credential pi itself holds for a provider. */
export function nativeCredential(providerId: string): Credential | undefined {
	return readStoredCredential(providerId);
}

/** The saved account that holds the same credential pi does, when a login wrote both. */
export function nativeDuplicate(
	providerId: string,
	accounts: readonly Account[],
): Account | undefined {
	const native = nativeCredential(providerId);
	if (native === undefined) return undefined;
	return accounts.find((account) => sameCredential(account.credential, native));
}

function sameCredential(a: Credential, b: Credential): boolean {
	if (a.type !== b.type) return false;
	if (a.type === "oauth" && b.type === "oauth")
		return a.refresh === b.refresh || a.access === b.access;
	if (a.type === "api_key" && b.type === "api_key") return a.key === b.key;
	return false;
}

/** The word a person reads for a credential type. */
export function kindText(type: Credential["type"] | undefined): string | undefined {
	if (type === undefined) return undefined;
	return type === "oauth" ? "subscription" : "api key";
}

/** One way a provider can log in, named the way its own login dialog names it. */
export interface LoginMethod {
	provider: Provider;
	authType: AuthType;
	label: string;
}

/** Every way this provider logs in, OAuth first. */
export function loginMethods(provider: Provider): LoginMethod[] {
	const methods: LoginMethod[] = [];
	const oauth = provider.auth.oauth;
	if (oauth !== undefined) {
		methods.push({ provider, authType: "oauth", label: oauth.loginLabel ?? oauth.name });
	}
	const apiKey = provider.auth.apiKey;
	if (apiKey?.login !== undefined)
		methods.push({ provider, authType: "api_key", label: apiKey.name });
	return methods;
}

/** Runs the provider's own login, so the OAuth flow and the key prompt both stay pi's. */
export async function login(
	method: LoginMethod,
	interaction: ProviderAuthInteraction,
): Promise<Credential> {
	if (method.authType === "oauth") {
		const oauth = method.provider.auth.oauth;
		if (oauth === undefined) throw new Error(`${method.provider.id} has no OAuth login`);
		return await oauth.login(interaction);
	}
	const apiKey = method.provider.auth.apiKey;
	if (apiKey?.login === undefined) throw new Error(`${method.provider.id} has no key login`);
	return await apiKey.login(interaction);
}
