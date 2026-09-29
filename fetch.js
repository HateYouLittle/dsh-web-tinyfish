import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";
//#region lib/types/provider.js
/**
 * TinyFish Fetch API provider for the web capability seam (`ctx.web`).
 *
 * `POST https://api.fetch.tinyfish.ai` renders the page when it needs to and
 * returns already-extracted text, so a successful fetch maps straight onto the
 * seam's `WebFetchResult`. Two shape differences are translated here:
 *
 * - TinyFish reports per-URL failures in `errors[]` beside an HTTP 200. The seam
 *   models a non-2xx origin response as a RESULT (`statusCode` + body) and every
 *   other failure as a thrown `WebError`, so status-bearing errors become
 *   results and the rest become typed errors.
 * - `format: "markdown"` already produces the text the model wants, so the body
 *   is `kind: "text"` and skips the tool's HTML→markdown conversion.
 * @module @local/dsh-web-tinyfish/fetch-provider
 */

/** Stable id this provider registers under, in the fetch registry. */
const TINYFISH_FETCH_PROVIDER_ID = "tinyfish";
/** Default TinyFish Fetch endpoint. */
const TINYFISH_FETCH_DEFAULT_BASE_URL = "https://api.fetch.tinyfish.ai";
/** Default credential reference for the API key. */
const TINYFISH_DEFAULT_API_KEY_ENV = "TINYFISH_API_KEY";
/** Environment variable that overrides the fetch endpoint, like the search provider's. */
const TINYFISH_FETCH_BASE_URL_ENV = "TINYFISH_FETCH_BASE_URL";
/** Default extraction format. */
const TINYFISH_FETCH_DEFAULT_FORMAT = "markdown";
/** Formats this provider can map onto the seam's closed `html | text` body union. */
const FETCH_FORMATS = ["markdown", "html"];
/** Default decoded-body cap, matching `@deepseek-ai/dsh-web-fetch-http`. */
const TINYFISH_FETCH_DEFAULT_MAX_BODY_CHARS = 1e5;
/** Attribution header sent on every request. */
const USER_AGENT = "deepseek-harness-tinyfish-fetch/1.0.0";
/**
 * Per-URL error codes that carry an origin HTTP status. The seam treats a
 * non-2xx origin response as a result, so these are returned rather than thrown.
 */
const STATUS_BEARING_ERRORS = /* @__PURE__ */ new Set(["target_http_error", "page_not_found"]);
/**
 * Map TinyFish's per-URL error codes onto the seam's `WebError` vocabulary.
 * Codes without a closer match stay `WEB_PROVIDER_ERROR`.
 */
const PER_URL_ERROR_CODES = {
	timeout: "WEB_FETCH_TIMEOUT",
	content_too_large: "WEB_FETCH_TOO_LARGE",
	invalid_url: "WEB_INVALID_URL",
	invalid_redirect_url: "WEB_BLOCKED_URL",
	target_unreachable: "WEB_PROVIDER_ERROR",
	bot_blocked: "WEB_PROVIDER_ERROR",
	login_required: "WEB_PROVIDER_ERROR",
	proxy_error: "WEB_PROVIDER_ERROR",
	empty_content: "WEB_PROVIDER_ERROR",
	selector_not_matched: "WEB_PROVIDER_ERROR",
	selector_unsupported: "WEB_PROVIDER_ERROR",
	conditional_unsupported: "WEB_PROVIDER_ERROR"
};
/** Human-readable meaning for each per-URL code, appended to the error message. */
const PER_URL_ERROR_HINTS = {
	bot_blocked: "the site served a bot-protection challenge; retrying without a different approach will not help",
	login_required: "the target redirected to a login or account wall, so anonymous retrieval cannot reach it",
	empty_content: "the browser returned HTML with no extractable text",
	target_unreachable: "connection refused, TLS failure, or DNS failure",
	proxy_error: "the proxy tunnel failed; the site may be reachable directly",
	selector_not_matched: "no element matched the requested selectors",
	selector_unsupported: "selectors cannot scope a direct PDF or CSV download",
	conditional_unsupported: "this URL needs browser rendering, which conditional requests do not support",
	content_too_large: "the document exceeds the 20 MB generic-document limit"
};
/** The TinyFish-backed fetch provider. Selection, redirect policy, and caps are described in Config. */
var TinyFishFetchProvider = class {
	resolveOptions;
	id = TINYFISH_FETCH_PROVIDER_ID;
	/**
	 * @param resolveOptions - the options for the NEXT operation, snapshotted
	 *   once per operation so one fetch never mixes two configurations.
	 */
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	/** Cheap local readiness check: a key source, a parseable endpoint, and a usable cap. */
	available() {
		const options = this.resolveOptions();
		return (options.apiKey.length > 0 || options.hasResolver) && URL.canParse(options.baseURL) && Number.isInteger(options.maxBodyChars) && options.maxBodyChars > 0;
	}
	/**
	 * Retrieve one URL through the TinyFish Fetch API.
	 *
	 * @param request - the seam's `url`.
	 * @param signal - optional cancellation signal, forwarded to `fetch`.
	 * @returns the final URL, the status code, the extracted body, and whether
	 *   the body hit `maxBodyChars`.
	 * @throws {@link WebError} `WEB_ABORTED` on cancellation, the mapped
	 *   per-URL code for retrieval failures, and `WEB_PROVIDER_ERROR` for
	 *   transport, protocol, or unrepresentable-body failures.
	 */
	async fetch(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.apiKey(options, signal);
		throwIfFetchAborted(signal);
		const endpoint = options.baseURL.replace(/\/+$/u, "");
		const body = {
			urls: [request.url],
			format: options.format,
			...options.ttl === void 0 ? {} : { ttl: options.ttl },
			...options.purpose.length > 0 ? { purpose: options.purpose } : {},
			...options.perUrlTimeoutMs === void 0 ? {} : { per_url_timeout_ms: options.perUrlTimeoutMs }
		};
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					"x-api-key": apiKey,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(body),
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error);
			throw new WebError(`TinyFish fetch request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			const status = response.status;
			let detail = "";
			try {
				detail = errorDetail(await response.json());
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error);
			}
			throw new WebError(tinyFishFetchErrorMessage(status, detail), "WEB_PROVIDER_ERROR");
		}
		let parsed;
		try {
			parsed = await response.json();
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error);
			throw new WebError(`TinyFish returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		return mapTinyFishFetchResponse(parsed, request.url, options.maxBodyChars);
	}
	/**
	 * Resolve one operation's API key without retaining it on the provider.
	 *
	 * @param options - the caller's snapshot, so the key and the endpoint it is
	 *   sent to come from one configuration.
	 * @param signal - abort signal for the surrounding fetch.
	 * @returns the resolved key.
	 * @throws {@link WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when none resolves.
	 */
	async apiKey(options, signal) {
		throwIfFetchAborted(signal);
		if (options.apiKey.length > 0) return options.apiKey;
		const { resolveApiKey } = options;
		const resolved = resolveApiKey === void 0 ? void 0 : await resolveApiKey(signal);
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		throw new WebError(`TinyFish fetch has no API key for "${options.apiKeyEnv}"; set a literal "apiKey" in the web-fetch-tinyfish config, store the credential through the credentials service, or export ${options.apiKeyEnv} in the launching environment. Create a key at https://agent.tinyfish.ai/api-keys`, "WEB_PROVIDER_CREDENTIAL_MISSING");
	}
};
/**
 * Map a TinyFish Fetch response envelope onto one seam result.
 *
 * @param parsed - the parsed response body (`results[]` and/or `errors[]`).
 * @param requestedUrl - the URL the caller asked for.
 * @param maxBodyChars - the decoded-body cap.
 * @returns the seam's fetch result.
 * @throws {@link WebError} for per-URL failures the seam models as errors, and
 *   for an envelope carrying neither a result nor an error.
 */
function mapTinyFishFetchResponse(parsed, requestedUrl, maxBodyChars) {
	const result = Array.isArray(parsed?.results) ? parsed.results[0] : void 0;
	if (result !== void 0) {
		const text = typeof result.text === "string" ? result.text : void 0;
		if (text === void 0) throw new WebError(`TinyFish returned no extractable text for ${requestedUrl}; the page may carry no readable content`, "WEB_PROVIDER_ERROR");
		const truncated = text.length > maxBodyChars;
		return {
			url: typeof result.final_url === "string" && result.final_url.length > 0 ? result.final_url : requestedUrl,
			statusCode: 200,
			body: {
				kind: "text",
				content: truncated ? text.slice(0, maxBodyChars) : text
			},
			truncated
		};
	}
	const failure = Array.isArray(parsed?.errors) ? parsed.errors[0] : void 0;
	if (failure === void 0) throw new WebError("TinyFish returned neither a result nor an error entry", "WEB_PROVIDER_ERROR");
	const code = typeof failure.error === "string" ? failure.error : "unknown";
	const url = typeof failure.url === "string" && failure.url.length > 0 ? failure.url : requestedUrl;
	if (STATUS_BEARING_ERRORS.has(code) && typeof failure.status === "number") {
		// The origin answered with a non-2xx status: the seam models that as a
		// result carrying the status, so the model can see the page's state.
		return {
			url,
			statusCode: failure.status,
			body: {
				kind: "text",
				content: `The origin returned HTTP ${failure.status}, so no body could be extracted (TinyFish error code "${code}").`
			},
			truncated: false
		};
	}
	const hint = PER_URL_ERROR_HINTS[code];
	throw new WebError(`TinyFish could not fetch ${url}: ${code}${hint === void 0 ? "" : ` — ${hint}`}`, PER_URL_ERROR_CODES[code] ?? "WEB_PROVIDER_ERROR");
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
 * Compose the failure message for an HTTP-level error, adding the recovery step
 * that the status code implies.
 *
 * @param status - the HTTP status code.
 * @param detail - the API's own error detail, when it sent one.
 * @returns the message for the thrown {@link WebError}.
 */
function tinyFishFetchErrorMessage(status, detail) {
	let message = `TinyFish Fetch API error (HTTP ${status})`;
	if (detail.length > 0) message += `: ${detail}`;
	if (status === 401) message += "\n\nThe TinyFish API key is missing or invalid. Check it at https://agent.tinyfish.ai/api-keys and update the web-fetch-tinyfish config.";
	else if (status === 403) message += "\n\nThis endpoint is not enabled for the TinyFish account (highlights are beta-gated).";
	else if (status === 429) message += "\n\nTinyFish rate limit reached (150 URLs per minute per key). Retry after a short wait.";
	else if (status === 503) message += "\n\nTinyFish fetch is temporarily unavailable; retry with backoff.";
	return message;
}
/** Throw the provider's stable cancellation error. */
function throwIfFetchAborted(signal) {
	if (signal?.aborted === true) throw fetchAborted(signal);
}
/** Build the provider's cancellation error while retaining the caller's reason. */
function fetchAborted(signal, fallback) {
	return new WebError("TinyFish fetch aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
//#endregion
//#region lib/types/index.js
/** Cordis plugin name used by loader diagnostics. */
const name = "web-fetch-tinyfish";
/** The web seam this provider registers into. */
const inject = ["web"];
const Config = z.object({
	apiKey: z.string().role("secret"),
	apiKeyEnv: z.string().role("credential-ref").default(TINYFISH_DEFAULT_API_KEY_ENV),
	baseURL: z.string().default(TINYFISH_FETCH_DEFAULT_BASE_URL),
	format: z.string().default(TINYFISH_FETCH_DEFAULT_FORMAT),
	purpose: z.string(),
	ttl: z.number().step(1).min(0),
	perUrlTimeoutMs: z.number().step(1).min(1),
	maxBodyChars: z.number().step(1).min(1).default(TINYFISH_FETCH_DEFAULT_MAX_BODY_CHARS)
});
/**
 * Project one resolved configuration into the options the provider serves its
 * next fetch with. The environment fallback stays here rather than in the
 * provider, so every value the provider reads is already fully defaulted.
 *
 * @param ctx - plugin context supplying the credentials and environment planes.
 * @param config - the currently authoritative configuration.
 * @returns options for one fetch.
 */
function resolveOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? TINYFISH_DEFAULT_API_KEY_ENV);
	const environment = launchEnvironmentOf(ctx);
	const credentials = ctx.get("credentials");
	return {
		apiKey: nonEmpty(config.apiKey) ?? nonEmpty(environment.get(apiKeyEnv)?.value) ?? "",
		hasResolver: credentials !== void 0,
		resolveApiKey: async (signal) => {
			throwIfFetchAborted(signal);
			if (credentials === void 0) return void 0;
			const hit = await credentials.resolve(apiKeyEnv);
			return hit !== void 0 && hit.value.length > 0 ? hit.value : void 0;
		},
		apiKeyEnv,
		baseURL: nonEmpty(config.baseURL) ?? nonEmpty(environment.get(TINYFISH_FETCH_BASE_URL_ENV)?.value) ?? TINYFISH_FETCH_DEFAULT_BASE_URL,
		format: config.format ?? TINYFISH_FETCH_DEFAULT_FORMAT,
		purpose: config.purpose ?? "",
		ttl: config.ttl,
		perUrlTimeoutMs: config.perUrlTimeoutMs,
		maxBodyChars: config.maxBodyChars
	};
}
/** Narrow an optional string to a non-empty one. */
function nonEmpty(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/** Register the TinyFish fetch provider with `ctx.web`. */
function apply(ctx, config) {
	const format = config.format ?? TINYFISH_FETCH_DEFAULT_FORMAT;
	if (!FETCH_FORMATS.includes(format)) throw new Error(`web-fetch-tinyfish: format must be one of ${FETCH_FORMATS.join(", ")}, got ${JSON.stringify(format)}`);
	ctx.web.registerFetchProvider(new TinyFishFetchProvider(() => resolveOptions(ctx, {
		apiKey: config.apiKey,
		apiKeyEnv: config.apiKeyEnv,
		baseURL: config.baseURL,
		format,
		purpose: config.purpose,
		ttl: config.ttl,
		perUrlTimeoutMs: config.perUrlTimeoutMs,
		maxBodyChars: config.maxBodyChars ?? TINYFISH_FETCH_DEFAULT_MAX_BODY_CHARS
	})));
}
//#endregion
export { Config, FETCH_FORMATS, TINYFISH_FETCH_BASE_URL_ENV, TINYFISH_FETCH_DEFAULT_BASE_URL, TINYFISH_FETCH_DEFAULT_FORMAT, TINYFISH_FETCH_DEFAULT_MAX_BODY_CHARS, TINYFISH_FETCH_PROVIDER_ID, TinyFishFetchProvider, apply, inject, mapTinyFishFetchResponse, name };
