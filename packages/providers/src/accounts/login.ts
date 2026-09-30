import type {
	AuthType,
	Credential,
	Provider,
	ProviderAuthInteraction,
} from "@earendil-works/pi-ai";

/** One way a provider can log in, named the way its own login dialog names it. */
export interface LoginMethod {
	provider: Provider;
	authType: AuthType;
	label: string;
}

/** Every way this provider logs in, OAuth first. */
export function loginMethods(provider: Provider): LoginMethod[] {
	const methods: LoginMethod[] = [];
	if (provider.auth.oauth !== undefined)
		methods.push({ provider, authType: "oauth", label: provider.auth.oauth.name });
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
