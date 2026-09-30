import { expect, test } from "bun:test";

import {
	createAssistantMessageEventStream,
	type Provider,
	type ProviderAuthInteraction,
} from "@earendil-works/pi-ai";

import { login, loginMethods } from "../src/accounts/login.ts";

function provider(auth: Provider["auth"]): Provider {
	return {
		id: "anthropic",
		name: "Anthropic",
		auth,
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => createAssistantMessageEventStream(),
	};
}

function interaction(): ProviderAuthInteraction {
	return { signal: new AbortController().signal, prompt: async () => "", notify: () => {} };
}

test("loginMethods offers OAuth first, then the key, and skips what is missing", () => {
	const both = provider({
		apiKey: {
			name: "API key",
			login: async () => ({ type: "api_key", key: "k" }),
			resolve: async () => undefined,
		},
		oauth: {
			name: "Claude Pro/Max",
			login: async () => ({ type: "oauth", access: "a", refresh: "r", expires: 0 }),
			refresh: async (credential) => credential,
			toAuth: async () => ({}),
		},
	});
	expect(loginMethods(both).map((method) => method.label)).toEqual(["Claude Pro/Max", "API key"]);

	const ambient = provider({ apiKey: { name: "Ambient", resolve: async () => undefined } });
	expect(loginMethods(ambient)).toEqual([]);
});

test("login runs the provider's own OAuth flow", async () => {
	const calls: string[] = [];
	const providerWith = provider({
		oauth: {
			name: "Claude",
			login: async () => {
				calls.push("oauth");
				return { type: "oauth", access: "a", refresh: "r", expires: 0 };
			},
			refresh: async (credential) => credential,
			toAuth: async () => ({}),
		},
	});

	const credential = await login(loginMethods(providerWith)[0]!, interaction());
	expect(calls).toEqual(["oauth"]);
	expect(credential.type).toBe("oauth");
});

test("login runs the provider's own key prompt", async () => {
	const providerWith = provider({
		apiKey: {
			name: "API key",
			login: async () => ({ type: "api_key", key: "typed" }),
			resolve: async () => undefined,
		},
	});

	const credential = await login(loginMethods(providerWith)[0]!, interaction());
	expect(credential).toEqual({ type: "api_key", key: "typed" });
});
