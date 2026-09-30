// A provider with accounts is re-registered with its stream wrapped: each request resolves the
// credential of the active account and injects it, so one provider keeps one model list. The auth
// methods of the native provider do the work, so this file never speaks OAuth.
import {
	defaultProviderAuthContext,
	lazyStream,
	type Api,
	type ApiStreamOptions,
	type AssistantMessageEventStream,
	type Credential,
	type Model,
	type ModelAuth,
	type OAuthAuth,
	type OAuthCredential,
	type Provider,
	type ProviderAuth,
	type ProviderEnv,
	type ProviderHeaders,
	type SimpleStreamOptions,
	type StreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

/** Where a refreshed token lands, so the next request does not refresh again. */
export interface AccountSession {
	credential(): Credential | undefined;
	saveCredential(credential: Credential): void;
}

/** The native provider behind a lifted one, so lifting twice wraps the same object. */
const NATIVE = Symbol.for("pi-providers.accounts.native");

/** The provider a lifted one came from, or the provider itself. */
export function nativeOf(provider: Provider): Provider {
	return (provider as { [NATIVE]?: Provider })[NATIVE] ?? provider;
}

export function liftProvider(provider: Provider, session: AccountSession): Provider {
	// Every method is delegated by hand, not by spread: the native may keep methods on a prototype,
	// and a copied method would lose its `this`.
	const getAllModels = provider.getAllModels;
	const refreshModels = provider.refreshModels;
	const filterModels = provider.filterModels;
	const filterAllModels = provider.filterAllModels;
	const fetchDeferred = provider.fetchDeferred;
	const cancelDeferred = provider.cancelDeferred;
	const generateImages = provider.generateImages;
	const classify = provider.classify;

	const lifted: Provider = {
		id: provider.id,
		name: provider.name,
		...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
		...(provider.headers === undefined ? {} : { headers: provider.headers }),
		auth: liftedAuth(provider, session),
		getModels: () => provider.getModels(),
		...(getAllModels === undefined ? {} : { getAllModels: () => getAllModels() }),
		...(refreshModels === undefined ? {} : { refreshModels: (context) => refreshModels(context) }),
		...(filterModels === undefined
			? {}
			: { filterModels: (models, credential) => filterModels(models, credential) }),
		...(filterAllModels === undefined
			? {}
			: { filterAllModels: (models, credential) => filterAllModels(models, credential) }),
		stream<T extends Api>(
			model: Model<T>,
			context: TranscriptContext,
			options?: ApiStreamOptions<T>,
		) {
			return accountStream(provider, session, "stream", model, context, options);
		},
		streamSimple(model, context, options) {
			return accountStream(provider, session, "streamSimple", model, context, options);
		},
		...(fetchDeferred === undefined
			? {}
			: { fetchDeferred: (model, handle, options) => fetchDeferred(model, handle, options) }),
		...(cancelDeferred === undefined
			? {}
			: { cancelDeferred: (model, handle, options) => cancelDeferred(model, handle, options) }),
		...(generateImages === undefined
			? {}
			: { generateImages: (model, context, options) => generateImages(model, context, options) }),
		...(classify === undefined
			? {}
			: { classify: (model, context, options) => classify(model, context, options) }),
	};
	Object.defineProperty(lifted, NATIVE, { value: provider, enumerable: false });
	return lifted;
}

type Options = StreamOptions;

function accountStream(
	provider: Provider,
	session: AccountSession,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options?: Options,
): AssistantMessageEventStream {
	const credential = session.credential();
	if (credential === undefined) return call(provider, kind, model, context, options ?? {});

	return lazyStream(model, async () => {
		const resolved = await resolveAuth(provider, session, credential, options?.signal);
		const withAuth = applyAuth(resolved, model, options ?? {});
		return call(provider, kind, withAuth.model, context, withAuth.options);
	});
}

function call(
	provider: Provider,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options: Options,
): AssistantMessageEventStream {
	if (kind === "streamSimple")
		return provider.streamSimple(model, context, options as SimpleStreamOptions);
	return provider.stream(model, context, options as ApiStreamOptions<Api>);
}

interface ResolvedAuth {
	auth: ModelAuth;
	env?: ProviderEnv;
}

async function resolveAuth(
	provider: Provider,
	session: AccountSession,
	credential: Credential,
	signal: AbortSignal | undefined,
): Promise<ResolvedAuth> {
	const abort = signal ?? new AbortController().signal;
	if (credential.type === "oauth") {
		const oauth = provider.auth.oauth;
		if (oauth === undefined) return { auth: {} };
		const fresh = await refreshToken(oauth, session, credential, abort);
		return { auth: await oauth.toAuth(fresh) };
	}

	const apiKey = provider.auth.apiKey;
	if (apiKey === undefined) return { auth: {} };
	const resolved = await apiKey.resolve({
		ctx: defaultProviderAuthContext(),
		credential,
		signal: abort,
	});
	return resolved === undefined ? { auth: {} } : { auth: resolved.auth, env: resolved.env };
}

// Pi refreshes its own token under the store lock. Ours is ours to refresh, five minutes early.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function refreshToken(
	oauth: OAuthAuth,
	session: AccountSession,
	credential: OAuthCredential,
	signal: AbortSignal,
): Promise<OAuthCredential> {
	if (credential.expires > Date.now() + REFRESH_MARGIN_MS) return credential;
	const fresh = await oauth.refresh(credential, signal);
	session.saveCredential(fresh);
	return fresh;
}

function applyAuth(
	resolved: ResolvedAuth,
	model: Model<Api>,
	options: Options,
): { model: Model<Api>; options: Options } {
	const next: Options = { ...options };
	if (resolved.auth.apiKey === undefined) delete next.apiKey;
	else next.apiKey = resolved.auth.apiKey;

	const headers = mergeHeaders(options.headers, resolved.auth.headers);
	if (headers === undefined) delete next.headers;
	else next.headers = headers;

	if (resolved.env === undefined && options.env === undefined) delete next.env;
	else next.env = { ...options.env, ...resolved.env };

	return {
		model:
			resolved.auth.baseUrl === undefined ? model : { ...model, baseUrl: resolved.auth.baseUrl },
		options: next,
	};
}

function mergeHeaders(
	base: ProviderHeaders | undefined,
	override: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
	if (base === undefined && override === undefined) return undefined;
	const merged: ProviderHeaders = { ...base };
	for (const [name, value] of Object.entries(override ?? {})) {
		const lower = name.toLowerCase();
		for (const existing of Object.keys(merged)) {
			if (existing.toLowerCase() === lower) delete merged[existing];
		}
		merged[name] = value;
	}
	return merged;
}

// The runtime reads auth from the provider, so it has to report configured when an account exists,
// even though the credential itself is injected into the request by `accountStream`. Reporting the
// account's own type keeps `isUsingOAuth` honest, which is what bills a subscription request.
function liftedAuth(provider: Provider, session: AccountSession): ProviderAuth {
	const original = provider.auth.apiKey;
	const login = original?.login;
	return {
		apiKey: {
			name: original?.name ?? `${provider.name} accounts`,
			...(login === undefined ? {} : { login: (interaction) => login(interaction) }),
			async check(input) {
				const credential = session.credential();
				if (credential !== undefined) return { type: credential.type, source: "account" };
				return original?.check?.(input);
			},
			async resolve(input) {
				if (session.credential() !== undefined) return { auth: {}, source: "account" };
				return original?.resolve(input);
			},
		},
		...(provider.auth.oauth === undefined ? {} : { oauth: provider.auth.oauth }),
	};
}
