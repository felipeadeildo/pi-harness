// A provider with accounts is re-registered with its stream wrapped: each request resolves the
// credential of the active account and injects it, so one provider keeps one model list. The auth
// methods of the native provider do the work, so this file never speaks OAuth.
import {
	defaultProviderAuthContext,
	lazyStream,
	type Api,
	type ApiStreamOptions,
	type AssistantMessage,
	type AssistantMessageEvent,
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

import { classifyFailure } from "../errors.ts";
import { DEFAULT_ACCOUNT } from "./types.ts";

/** The account the next request uses, and where a refreshed token is kept. */
export interface AccountSession {
	resolve(): { id: string; credential: Credential } | undefined;
	save(id: string, credential: Credential): void;
	/** The account to try after this one hit a limit, or undefined to surface the error. */
	afterLimit(
		currentId: string,
		detail: string,
	): Promise<{ id: string; credential: Credential } | undefined>;
	/** The credential was refused, so sign in again or try another account. */
	afterAuthFailure?(
		currentId: string,
		detail: string,
	): Promise<{ id: string; credential: Credential } | undefined>;
	/** The account served a request, so a limit it had is over. */
	served?(id: string): void;
}

/** The native provider behind a lifted one, so lifting twice wraps the same object. */
const NATIVE = Symbol.for("pi-providers.accounts.native");

/** The provider a lifted one came from, or the provider itself. */
export function nativeOf(provider: Provider): Provider {
	return (provider as { [NATIVE]?: Provider })[NATIVE] ?? provider;
}

export function liftProvider(provider: Provider, session: AccountSession): Provider {
	// Every method is delegated by hand, not by spread: the native may keep methods on a prototype,
	// and a copied method would lose its `this`. One refresh runs per account at a time.
	const refreshing = new Map<string, Promise<OAuthCredential>>();
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
			return accountStream(provider, session, refreshing, "stream", model, context, options);
		},
		streamSimple(model, context, options) {
			return accountStream(provider, session, refreshing, "streamSimple", model, context, options);
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
	refreshing: Map<string, Promise<OAuthCredential>>,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options?: Options,
): AssistantMessageEventStream {
	// Even without an account chosen, a failure can move to one: pi's own credential is not an account,
	// but the provider still has accounts behind it.
	const first = session.resolve();
	const settled = options ?? {};
	return lazyStream(model, async () =>
		attempts(provider, session, refreshing, kind, model, context, settled, first),
	);
}

/** One account may serve a limit that another one does not have. A re-login costs an attempt too. */
const MAX_ATTEMPTS = 3;

async function* attempts(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options: Options,
	first: { id: string; credential: Credential } | undefined,
): AsyncGenerator<AssistantMessageEvent> {
	let account = first;

	for (let attempt = 1; ; attempt++) {
		// Hold the events until something is visible: a retry on another account must not repeat a
		// message the caller already saw.
		const buffered: AssistantMessageEvent[] = [];
		let output = false;
		let failure: AssistantMessage | undefined;
		let thrown: unknown;
		try {
			// The auth resolution is inside the try too: a refresh that fails is an auth failure, and it
			// must be able to move to the next account like any other.
			// oxlint-disable-next-line no-await-in-loop -- an attempt starts only after the one before it.
			const withAuth = await authFor(provider, session, refreshing, account, model, options);
			const source = call(provider, kind, withAuth.model, context, withAuth.options);

			// oxlint-disable-next-line no-await-in-loop -- a stream is read one event at a time.
			for await (const event of source) {
				if (isContent(event)) {
					if (!output) {
						output = true;
						yield* buffered;
						buffered.length = 0;
					}
					yield event;
					continue;
				}
				if (event.type === "error") failure = event.error;
				if (output) yield event;
				else buffered.push(event);
			}
		} catch (error) {
			thrown = error;
		}

		if (failure === undefined && thrown === undefined)
			session.served?.(account?.id ?? DEFAULT_ACCOUNT);

		if (!output && attempt < MAX_ATTEMPTS) {
			const problem =
				failure?.errorMessage !== undefined
					? classifyFailure(failure.errorMessage, model.provider)
					: thrown === undefined
						? undefined
						: classifyFailure(thrown, model.provider);
			const next =
				problem?.kind === "usage"
					? // oxlint-disable-next-line no-await-in-loop -- the answer comes from the user.
						await session.afterLimit(account?.id ?? DEFAULT_ACCOUNT, problem.message)
					: problem?.kind === "auth"
						? // oxlint-disable-next-line no-await-in-loop -- the answer comes from the user.
							await session.afterAuthFailure?.(account?.id ?? DEFAULT_ACCOUNT, problem.message)
						: undefined;
			if (next !== undefined) {
				account = next;
				continue;
			}
		}

		yield* buffered;
		if (thrown !== undefined) throw thrown;
		return;
	}
}

function isContent(event: AssistantMessageEvent): boolean {
	return event.type !== "start" && event.type !== "done" && event.type !== "error";
}

/** The request auth for an attempt: the account's, or untouched when pi's own credential serves. */
async function authFor(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	account: { id: string; credential: Credential } | undefined,
	model: Model<Api>,
	options: Options,
): Promise<{ model: Model<Api>; options: Options }> {
	if (account === undefined) return { model, options };
	const resolved = await resolveAuth(provider, session, refreshing, account, options.signal);
	return applyAuth(resolved, model, options);
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
	refreshing: Map<string, Promise<OAuthCredential>>,
	account: { id: string; credential: Credential },
	signal: AbortSignal | undefined,
): Promise<ResolvedAuth> {
	const abort = signal ?? new AbortController().signal;
	if (account.credential.type === "oauth") {
		const oauth = provider.auth.oauth;
		if (oauth === undefined) return { auth: {} };
		const fresh = await refreshToken(
			oauth,
			session,
			refreshing,
			account.id,
			account.credential,
			abort,
		);
		return { auth: await oauth.toAuth(fresh) };
	}

	const apiKey = provider.auth.apiKey;
	if (apiKey === undefined) return { auth: {} };
	const resolved = await apiKey.resolve({
		ctx: defaultProviderAuthContext(),
		credential: account.credential,
		signal: abort,
	});
	return resolved === undefined ? { auth: {} } : { auth: resolved.auth, env: resolved.env };
}

// Pi refreshes its own token under the store lock, five minutes early. Ours is ours to refresh, and
// one refresh per account is shared, so two requests cannot rotate the token twice.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function refreshToken(
	oauth: OAuthAuth,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	accountId: string,
	credential: OAuthCredential,
	signal: AbortSignal,
): Promise<OAuthCredential> {
	if (credential.expires > Date.now() + REFRESH_MARGIN_MS) return credential;

	const inFlight = refreshing.get(accountId);
	if (inFlight !== undefined) return await inFlight;

	const task = oauth.refresh(credential, signal).then((fresh) => {
		session.save(accountId, fresh);
		return fresh;
	});
	refreshing.set(accountId, task);
	try {
		return await task;
	} finally {
		refreshing.delete(accountId);
	}
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
				const account = session.resolve();
				if (account !== undefined) return { type: account.credential.type, source: "account" };
				return original?.check?.(input);
			},
			async resolve(input) {
				if (session.resolve() !== undefined) return { auth: {}, source: "account" };
				return original?.resolve(input);
			},
		},
		...(provider.auth.oauth === undefined ? {} : { oauth: provider.auth.oauth }),
	};
}
