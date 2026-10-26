import type {
	AuthType,
	Credential,
	Provider,
	ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

export function piLogin(providerId: string): Credential | undefined {
	return readStoredCredential(providerId);
}

export function kindText(type: Credential["type"]): string {
	return type === "oauth" ? "subscription" : "api key";
}

export interface LoginMethod {
	provider: Provider;
	authType: AuthType;
	label: string;
}

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

/** The OAuth flow and the key prompt both stay pi's. */
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
