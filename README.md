# dsh-web-tinyfish

[TinyFish](https://docs.tinyfish.ai/) **search** and **fetch** providers for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), backing the built-in
`web_search` and `web_fetch` tools.

| Tool | Seam method | Registry | TinyFish endpoint |
|---|---|---|---|
| `web_search` | `ctx.web.search()` | search | `GET https://api.search.tinyfish.ai` |
| `web_fetch` | `ctx.web.fetch()` | fetch | `POST https://api.fetch.tinyfish.ai` |

One bundle, two plugin rows. DSH ships `deepseek-official` for search
(`@deepseek-ai/dsh-web-search-deepseek`) and `http` for fetch
(`@deepseek-ai/dsh-web-fetch-http`); the seam is pluggable, so this bundle adds a `tinyfish`
provider to **both** registries and pins both settings to it. The shipped providers stay
installed, so reverting is a one-line config change.

Both rows register under the id `tinyfish`. The seam keeps separate search and fetch registries,
so the two ids never collide and one name covers both capabilities.

## Why TinyFish

TinyFish Search and Fetch are free at any wallet balance (the account only needs API access).
Compared with DSH's anonymous local HTTP fetcher, the TinyFish fetch provider adds:

- **JavaScript rendering** — SPA and script-driven documentation sites return real content
  instead of an empty shell;
- **bot-protection handling** — blocked pages surface as an explicit `bot_blocked` error
  rather than a challenge page body;
- **PDF text extraction** — the local provider cannot decode PDFs at all;
- **boilerplate-free extraction** — clean Markdown (or HTML/JSON) with page metadata, instead
  of raw HTML that must be converted downstream.

The trade-off is that fetched URLs are sent to TinyFish instead of being requested from your
own machine. TinyFish rejects private IPs, localhost, and cloud metadata endpoints, so the
SSRF protection the local provider enforced is preserved, but it is now enforced by TinyFish's
servers rather than locally. Point `fetchProvider` back at `http` for anything sensitive.

## Install

Requires DSH and a TinyFish API key (create one at https://agent.tinyfish.ai/api-keys).

```sh
dsh plugin --profile <profile> add dsh-web-tinyfish
```

The profile must already exist — this CLI boots the profile before running the command. For the
Desktop-managed `desktop` profile the CLI refuses to act, so use the Web UI: **Plugins → Add plugin**,
enter `dsh-web-tinyfish`, then **Enable now**. Installing the bundle applies its patch layer, which
registers both providers and pins `web.searchProvider` / `web.fetchProvider` to `tinyfish`.

> **Supply the key before or with the install.** The bundle pins both settings, so in a profile with no
> key (`TINYFISH_API_KEY` credential, environment variable, or private config override) the providers
> report unavailable and both `web_search` and `web_fetch` fail with
> `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`. Reverting is one line: point `web.searchProvider` back at
> `deepseek-official` and `web.fetchProvider` back at `http`.

### Supply the API key

This package deliberately ships **no** API key. The providers resolve it in this order:

1. a literal `apiKey` in the row's config;
2. the credentials service, under the ref named by `apiKeyEnv` (default `TINYFISH_API_KEY`);
3. the `TINYFISH_API_KEY` environment variable of the launching process.

The credentials service is the recommended home. If you prefer a config literal, put it in a
**private** override rather than in this package — DSH's own user layer
(`$DSH_HOME/profiles/<name>/cordis.patch.yml`) is never published and applies after every
bundle layer:

```yaml
- id: web-search-tinyfish
  config:
    apiKey: 'sk-tinyfish-...'
- id: web-fetch-tinyfish
  config:
    apiKey: 'sk-tinyfish-...'
```

A Loader patch replaces a row's whole `config`, so a private override that sets only `apiKey`
falls back to this bundle's defaults for every other field.

## Configuration

### Row `web-search-tinyfish`

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | — | Literal API key (`role: secret`), highest priority |
| `apiKeyEnv` | `TINYFISH_API_KEY` | Credential reference and environment fallback |
| `baseURL` | `https://api.search.tinyfish.ai` | Endpoint; `TINYFISH_SEARCH_BASE_URL` also overrides it |
| `purpose` | — | Why the search runs (≤ 2000 chars); improves result quality |
| `location` | API default (`US`) | Country code, e.g. `HK` |
| `language` | API default (`en`) | Language code, e.g. `zh` |
| `domainType` | `web` | `web`, `news`, or `research_paper` |
| `recencyMinutes` | — | Freshness window, 1 … 5256000 |
| `page` | `0` | Result page, 0 … 10 |

### Row `web-fetch-tinyfish`

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | — | Literal API key (`role: secret`) |
| `apiKeyEnv` | `TINYFISH_API_KEY` | Credential reference and environment fallback |
| `baseURL` | `https://api.fetch.tinyfish.ai` | Endpoint; `TINYFISH_FETCH_BASE_URL` also overrides it |
| `format` | `markdown` | `markdown` → seam text body; `html` → seam html body (the tool converts) |
| `ttl` | `0` | Cache freshness in seconds; `0` = always live |
| `perUrlTimeoutMs` | — | Per-URL budget, 1 … 110000 ms |
| `maxBodyChars` | `100000` | Decoded-body cap; longer bodies are truncated and flagged |
| `purpose` | — | Why the page is fetched |

### The seam pin

The bundle also overrides DSH's own `web` row. That override replaces the row's whole `config`,
so it restates both shipped fields:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tinyfish   # was: deepseek-official
    fetchProvider: tinyfish    # was: http
```

## Behaviour

### Search

- One page of TinyFish results as seam sources: `title` → `title`, `snippet` → `snippet`,
  `date` → `publishedAt`. Entries with no URL are dropped and URLs are deduplicated.
- Never truncates itself: `web_search` passes `maxResults` (default 8) to the seam, which owns
  that cap and sets `truncated`.

### Fetch

- `format: markdown` maps to the seam's `kind: "text"` body, so the tool passes the text through
  without an HTML→markdown conversion. `format: html` maps to `kind: "html"`.
- `url` is the post-redirect `final_url`; `statusCode` is `200` on success.
- TinyFish reports per-URL failures in `errors[]` beside an HTTP 200, which the seam models
  differently, so this provider translates:
  - `page_not_found` / `target_http_error` carry an origin status. The seam treats a non-2xx
    origin response as a **result**, so these become a result with that `statusCode` and an
    explanatory body — the model sees `Fetched … (HTTP 404)` rather than an opaque failure.
  - every other per-URL code becomes a typed `WebError`: `timeout` → `WEB_FETCH_TIMEOUT`,
    `content_too_large` → `WEB_FETCH_TOO_LARGE`, `invalid_url` → `WEB_INVALID_URL`,
    `invalid_redirect_url` → `WEB_BLOCKED_URL`, and `bot_blocked`, `login_required`,
    `target_unreachable`, `proxy_error`, `empty_content`, `selector_*` → `WEB_PROVIDER_ERROR`
    with a hint appended.

### Both

- Failures are typed `WebError`s: `WEB_ABORTED` on cancellation,
  `WEB_PROVIDER_CREDENTIAL_MISSING` when no key resolves, and `WEB_PROVIDER_ERROR` for
  HTTP, transport, or unrepresentable-body failures. 401/402/403/429/503 messages carry the
  matching recovery step.
- Requests that carry credentials set `redirect: "error"`, so a redirect response is rejected
  before the API key can be forwarded to another origin.

## Compatibility

The package declares **no dependencies**. `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-web`,
`@deepseek-ai/dsh-credentials`, and `@deepseek-ai/dsh-launch-environment` are all carried by the
DSH installation and are supplied to profile code by DSH's runtime resolution, so importing them
from an installed bundle works without reinstalling them.

DSH is in developer preview and explicitly warns about compatibility-breaking changes. Pinning
`@deepseek-ai/*` peer versions from a community package can trip DSH's plugin compatibility
check, because the installed runtime usually moves ahead of the published line; that is why this
package declares none.

## Verify

After installing, both rows should appear under the bundle on the **Plugins** page. Then:

- `web_search` with any query — results should cite real URLs returned by TinyFish Search;
- `web_fetch` on a JavaScript-heavy page — the returned body should be clean Markdown rather
  than raw markup;
- to confirm the fetch path end to end, point `baseURL` at a local server, fetch, and observe
  the `POST` with `{"urls":[...],"format":"markdown","ttl":0}`.

## License

MIT
