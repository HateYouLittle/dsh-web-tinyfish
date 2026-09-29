import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";
//#region lib/types/provider.js
/**
 * TinyFish Search API provider for the web capability seam (`ctx.web`).
 *
 * `GET https://api.search.tinyfish.ai` returns a structured result list
 * (`title`/`snippet`/`url`/`date`), which maps one-to-one onto the seam's
 * `WebSource` vocabulary. The seam owns the `maxResults` bound, so this
 * provider returns everything the API gave it and never truncates itself.
 * @module @local/dsh-web-tinyfish/provider
 */

/** Stable id this provider registers under. */
const TINYFISH_PROVIDER_ID = "tinyfish";
/** Default TinyFish Search endpoint. */
const TINYFISH_DEFAULT_BASE_URL = "https://api.search.tinyfish.ai";
/** Default credential reference for the API key. */
const TINYFISH_DEFAULT_API_KEY_ENV = "TINYFISH_API_KEY";
/** Environment variable that overrides the search endpoint, like the DeepSeek provider's. */
const TINYFISH_BASE_URL_ENV = "TINYFISH_SEARCH_BASE_URL";
/** Default `domain_type`; the API's own default. */
const TINYFISH_DEFAULT_DOMAIN_TYPE = "web";
/** Accepted `domain_type` values. */
const DOMAIN_TYPES = ["web", "news", "research_paper"];
/** Attribution header sent on every request. */
const USER_AGENT = "deepseek-harness-tinyfish-search/1.0.0";

/**
 * Map one TinyFish `results[]` entry to the seam's source shape. Only `url` is
 * required: an entry without a URL is dropped, while a missing title, snippet,
 * or date is simply omitted so the seam's optional fields stay optional.
 *
 * @param result - one entry of TinyFish's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no URL.
 */
function mapTinyFishResult(result) {
	const url = typeof result?.url === "string" ? result.url : "";
	if (url.length === 0) return void 0;
	const title = typeof result.title === "string" && result.title.length > 0 ? result.title : void 0;
	const snippet = typeof result.snippet === "string" && result.snippet.length > 0 ? result.snippet : void 0;
	const publishedAt = typeof result.date === "string" && result.date.length > 0 ? result.date : void 0;
	return {
		url,
		...title === void 0 ? {} : { title },
		...snippet === void 0 ? {} : { snippet },
		...publishedAt === void 0 ? {} : { publishedAt }
	};
}
/**
 * Map a TinyFish Search response envelope to a normalized search result,
 * deduplicating by URL (the API can repeat a URL across a page).
 *
 * @param response - the parsed response body.
 * @returns the normalized result; `truncated` is always `false` because the
 *   seam, not the provider, owns the `maxResults` bound.
 */
function mapTinyFishResponse(response) {
	const results = Array.isArray(response?.results) ? response.results : [];
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const result of results) {
		const source = mapTinyFishResult(result);
		if (source === void 0 || seen.has(source.url)) continue;
		seen.add(source.url);
		sources.push(source);
	}
	return {
		sources,
		truncated: false
	};
}
/** The TinyFish-backed search provider. Selection and cancellation are the seam's. */
var TinyFishSearchProvider = class {
	resolveOptions;
	id = TINYFISH_PROVIDER_ID;
	/**
	 * @param resolveOptions - the options for the NEXT operation, snapshotted
	 *   once per operation so one search never mixes two configurations.
	 */
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	/** Cheap local readiness check: a key source, a parseable endpoint, and sane filters. */
	available() {
		const options = this.resolveOptions();
		return (options.apiKey.length > 0 || options.hasResolver) && URL.canParse(options.baseURL);
	}
	/**
	 * Run one search through the TinyFish Search API.
	 *
	 * @param request - the seam's `query` plus optional `maxResults` (ignored
	 *   here: the API has no count parameter and the seam applies the cap).
	 * @param signal - optional cancellation signal, forwarded to `fetch`.
	 * @returns the normalized sources.
	 * @throws {@link WebError} `WEB_ABORTED` on cancellation and
	 *   `WEB_PROVIDER_ERROR` for every HTTP, transport, or body failure.
	 */
	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.apiKey(options, signal);
		throwIfSearchAborted(signal);
		const url = buildSearchUrl(options, request.query);
		let response;
		try {
			response = await fetch(url, {
				method: "GET",
				redirect: "error",
				headers: {
					"x-api-key": apiKey,
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`TinyFish search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			const status = response.status;
			let detail = "";
			try {
				detail = errorDetail(await response.json());
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			}
			throw new WebError(tinyFishErrorMessage(status, detail), "WEB_PROVIDER_ERROR");
		}
		try {
			return mapTinyFishResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`TinyFish returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
	/**
	 * Resolve one operation's API key without retaining it on the provider.
	 *
	 * @param options - the caller's snapshot, so the key and the endpoint it is
	 *   sent to come from one configuration.
	 * @param signal - abort signal for the surrounding search.
	 * @returns the resolved key.
	 * @throws {@link WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when none resolves.
	 */
	async apiKey(options, signal) {
		throwIfSearchAborted(signal);
		if (options.apiKey.length > 0) return options.apiKey;
		const { resolveApiKey } = options;
		const resolved = resolveApiKey === void 0 ? void 0 : await resolveApiKey(signal);
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		throw new WebError(`TinyFish search has no API key for "${options.apiKeyEnv}"; set a literal "apiKey" in the web-search-tinyfish config, store the credential through the credentials service, or export ${options.apiKeyEnv} in the launching environment. Create a key at https://agent.tinyfish.ai/api-keys`, "WEB_PROVIDER_CREDENTIAL_MISSING");
	}
};
/**
 * Build the fully parameterized search URL. Only non-default filters are sent,
 * so an unconfigured provider issues exactly the request the docs show.
 *
 * @param options - one operation's resolved options.
 * @param query - the caller's query string.
 * @returns the URL to request.
 */
function buildSearchUrl(options, query) {
	const url = new URL(options.baseURL);
	url.searchParams.set("query", query);
	if (options.purpose.length > 0) url.searchParams.set("purpose", options.purpose);
	if (options.location.length > 0) url.searchParams.set("location", options.location);
	if (options.language.length > 0) url.searchParams.set("language", options.language);
	if (options.domainType !== TINYFISH_DEFAULT_DOMAIN_TYPE) url.searchParams.set("domain_type", options.domainType);
	if (options.recencyMinutes !== void 0) url.searchParams.set("recency_minutes", String(options.recencyMinutes));
	if (options.page > 0) url.searchParams.set("page", String(options.page));
	return url;
}
/**
 * Read the API's `{ "error": { "code", "message" } }` envelope, tolerating the
 * plain-string and top-level `message` variants.
 *
 * @param body - the parsed error body.
 * @returns the human-readable detail, or `""` when the body carries none.
 */
function errorDetail(body) {
	const detail = typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message;
	return typeof detail === "string" ? detail : "";
}
/**
 * Compose the failure message, adding the recovery step that the status code
 * implies. Search is free at any wallet balance, so 401/402/403 point at
 * account access rather than at money.
 *
 * @param status - the HTTP status code.
 * @param detail - the API's own error detail, when it sent one.
 * @returns the message for the thrown {@link WebError}.
 */
function tinyFishErrorMessage(status, detail) {
	let message = `TinyFish API error (HTTP ${status})`;
	if (detail.length > 0) message += `: ${detail}`;
	if (status === 401) message += "\n\nThe TinyFish API key is missing or invalid. Check it at https://agent.tinyfish.ai/api-keys and update the web-search-tinyfish config.";
	else if (status === 402) message += "\n\nThe TinyFish account has no access to the Search API. Search is free at any wallet balance, but the account still needs access; check https://agent.tinyfish.ai/api-keys.";
	else if (status === 429) message += "\n\nTinyFish rate limit reached (30 requests per minute per key). Retry after a short wait.";
	else if (status === 503) message += "\n\nTinyFish search is temporarily unavailable; retry with backoff.";
	return message;
}
/** Throw the provider's stable cancellation error. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}
/** Build the provider's cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
	return new WebError("TinyFish search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
//#endregion
//#region lib/types/index.js
/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-tinyfish";
/** The web seam this provider registers into. */
const inject = ["web"];
const Config = z.object({
	apiKey: z.string().role("secret"),
	apiKeyEnv: z.string().role("credential-ref").default(TINYFISH_DEFAULT_API_KEY_ENV),
	baseURL: z.string().default(TINYFISH_DEFAULT_BASE_URL),
	purpose: z.string(),
	location: z.string(),
	language: z.string(),
	domainType: z.string().default(TINYFISH_DEFAULT_DOMAIN_TYPE),
	recencyMinutes: z.number().step(1).min(1),
	page: z.number().step(1).min(0)
});
/**
 * Project one resolved configuration into the options the provider serves its
 * next search with. The environment fallback stays here rather than in the
 * provider, so every value the provider reads is already fully defaulted.
 *
 * @param ctx - plugin context supplying the credentials and environment planes.
 * @param config - the currently authoritative configuration.
 * @returns options for one search.
 */
function resolveOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? TINYFISH_DEFAULT_API_KEY_ENV);
	const literalApiKey = nonEmpty(config.apiKey);
	const environment = launchEnvironmentOf(ctx);
	const ambientApiKey = nonEmpty(environment.get(apiKeyEnv)?.value);
	const credentials = ctx.get("credentials");
	return {
		apiKey: literalApiKey ?? ambientApiKey ?? "",
		hasResolver: credentials !== void 0,
		resolveApiKey: async (signal) => {
			throwIfSearchAborted(signal);
			if (credentials === void 0) return void 0;
			const hit = await credentials.resolve(apiKeyEnv);
			return hit !== void 0 && hit.value.length > 0 ? hit.value : void 0;
		},
		apiKeyEnv,
		baseURL: nonEmpty(config.baseURL) ?? nonEmpty(environment.get(TINYFISH_BASE_URL_ENV)?.value) ?? TINYFISH_DEFAULT_BASE_URL,
		purpose: config.purpose ?? "",
		location: config.location ?? "",
		language: config.language ?? "",
		domainType: config.domainType ?? TINYFISH_DEFAULT_DOMAIN_TYPE,
		recencyMinutes: config.recencyMinutes,
		page: config.page ?? 0
	};
}
/** Narrow an optional string to a non-empty one. */
function nonEmpty(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/** Register the TinyFish search provider with `ctx.web`. */
function apply(ctx, config) {
	const domainType = config.domainType ?? TINYFISH_DEFAULT_DOMAIN_TYPE;
	if (!DOMAIN_TYPES.includes(domainType)) throw new Error(`web-search-tinyfish: domainType must be one of ${DOMAIN_TYPES.join(", ")}, got ${JSON.stringify(domainType)}`);
	ctx.web.registerSearchProvider(new TinyFishSearchProvider(() => resolveOptions(ctx, {
		apiKey: config.apiKey,
		apiKeyEnv: config.apiKeyEnv,
		baseURL: config.baseURL,
		purpose: config.purpose,
		location: config.location,
		language: config.language,
		domainType,
		recencyMinutes: config.recencyMinutes,
		page: config.page
	})));
}
//#endregion
export { Config, DOMAIN_TYPES, TINYFISH_BASE_URL_ENV, TINYFISH_DEFAULT_API_KEY_ENV, TINYFISH_DEFAULT_BASE_URL, TINYFISH_DEFAULT_DOMAIN_TYPE, TINYFISH_PROVIDER_ID, TinyFishSearchProvider, apply, inject, mapTinyFishResponse, name };
