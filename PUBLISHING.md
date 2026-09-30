# Publishing `dsh-web-tinyfish`

Repo-only checklist (this file is outside the npm `files` whitelist, so it ships to git but not to npm).

## Can this go into the official `deepseek-ai/deepseek-harness` repo?

**No — not right now.** `CONTRIBUTING.md` on `master` says it plainly:

> DeepSeek Harness is still at an early stage and under active development. We are sorry that we
> **cannot accept external pull requests at the moment.**

The repository has issues disabled and routes feedback through GitHub Discussions, so there is no
PR path for `packages/web/web-search-tinyfish`.

The officially recommended route is the one this package is built for:

> - **Create a plugin that excites you and share it with others:**
> - **Associate your GitHub project with the `dsh-plugin` topic** to help others discover your plugin.
> - ...We do not believe that packages in the official repository are inherently more important than
>   packages created by the community.

## 1. Identity — done

`package.json` (`repository` / `homepage` / `bugs` / `author`) and the `LICENSE` copyright now name
**HateYouLittle** and the repository
[`HateYouLittle/dsh-web-tinyfish`](https://github.com/HateYouLittle/dsh-web-tinyfish). Change them if
the package ever moves.

## 2. Verify before publishing

```powershell
# 1. the artifact: expect exactly 9 files and no secret
cd C:\workspace\tinyfish-dsh\dsh-web-tinyfish
npm pack --dry-run

# 2. the behaviour: manifest, patch, both Config schemas, wire format, live APIs
& "C:\Users\wangy\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "C:\workspace\tinyfish-dsh\verify\run.mjs"
```

Expected tarball contents (15.6 kB packed):

```
LICENSE  README.md  README.zh.md  cordis.patch.yml
fetch.js  index.js  locale/en.json  locale/zh.json  package.json
```

The suite's secret scan fails the run if any `sk-tinyfish-…` value reaches the package tree, so run
it after any edit to `cordis.patch.yml`.

## 3. Publish to npm — done, and the 2FA trap

**Released:** `dsh-web-tinyfish@1.0.0` (2026-09-30), published from the npm account `crackedopal`
(`https://www.npmjs.com/package/dsh-web-tinyfish`). `dsh-web-tinyfish` is unscoped, so no `--access`
flag is needed.

### Publishing now requires 2FA — and TOTP enrollment is gone

npm's current rule, quoting the docs:

> All packages now require two-factor authentication (2FA) **or** a granular access token with bypass
> 2FA enabled for creating and publishing packages.

Two dead ends hit on the way, so they are recorded here:

- A session token from `npm login` **cannot publish**. The registry answers
  `403 Forbidden … Two-factor authentication or granular access token with bypass 2fa enabled is
  required to publish packages.`
- `npm profile enable-2fa auth-and-writes` **no longer works**: npm stopped accepting new TOTP
  enrollments, and the command fails with
  `404 … Adding a new TOTP 2FA is no longer supported`. Account-level 2FA can now only be added as a
  **security key** (WebAuthn: Windows Hello, Touch ID, or a hardware key) at
  `https://www.npmjs.com/settings/<account>/tfa`.

**Working path used here** — a granular access token with Bypass 2FA, which sidesteps 2FA enrollment
entirely, because "when bypass 2FA is enabled, the token will bypass 2FA requirements for publishing,
regardless of account-level or package-level 2FA settings":

1. `https://www.npmjs.com/settings/<account>/tokens` → **Generate New Token** → **Granular Access Token**
2. Permissions **Read and write**; **Select packages: All packages** — necessary because the target
   package does not exist yet, so it cannot be selected. Narrow it to `dsh-web-tinyfish` afterwards.
3. **Bypass 2FA: enabled** (settable only at creation time)
4. `npm config set //registry.npmjs.org/:_authToken=npm_…`
5. `npm publish`

Keep the token's expiry short and revoke it after the release: it can publish packages directly.

### The publish is live even when npm says 404

Immediately after a successful publish, `npm view` and `pnpm add` returned **404** — local negative
caching, not a failed release. Confirm against the registry directly:

```powershell
& "C:\Users\wangy\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" -e `
  "fetch('https://registry.npmjs.org/dsh-web-tinyfish').then(r=>console.log(r.status)).then(()=>process.exit())"
```

Note also that pnpm's supply-chain gate logs
`Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml` for a brand-new release, because the
version is younger than the configured minimum release age.

If you would rather publish under a scope, rename the package to `@you/dsh-web-tinyfish`, update the
two `name:` specifiers in `cordis.patch.yml` to match, and publish with `--access public`. The row
`name` values **must** equal the installed package name, otherwise the Loader cannot import the rows.

## 4. Repository — created, first push done, topic set

The repository exists and is public; the first commits are pushed to `main`, and the **`dsh-plugin`**
topic is set. Later changes:

```sh
git add -A && git commit -m "…"
git push
```

## 5. How users install it

```sh
dsh plugin --profile <name> add dsh-web-tinyfish      # verified: installed 1.0.0 into the `web` profile
dsh plugin --profile <name> add "github:HateYouLittle/dsh-web-tinyfish#main"
```

`dsh plugin` takes `--profile` before the subcommand, and the profile must already exist: this CLI
boots the profile before running the command, so `dsh plugin --profile <new-name> add …` fails with
"profile does not exist". Use an existing profile, or the Web UI.

Or in the Web UI: **Plugins → Add plugin** → the package name or repo spec → **Install** → **Enable now**.
That is the supported path for the Desktop-managed `desktop` profile, which the CLI refuses to touch.

Only packages declaring `dsh.bundle.patch` become active profile layers — this one does. A plain
dependency installs but stays inactive.

> **Installing without a key degrades that profile's web tools.** The bundle pins
> `searchProvider`/`fetchProvider` to `tinyfish`, so in a profile that has no `TINYFISH_API_KEY`
> (credentials record, environment variable, or private config override) both providers report
> unavailable and `web_search` / `web_fetch` fail with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`. Supply
> the key in the same profile, or do not install the bundle there. This was observed directly while
> test-installing into an empty profile.

## 6. Where it will be discovered

| Channel | How it works |
|---|---|
| GitHub topic `dsh-plugin` | The official recommendation; catalogs scrape it |
| [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) | Community curated list, sourced from the topic |
| [dsh-plugin.org](https://dsh-plugin.org/) | Community market; "tag your repo `dsh-plugin` to submit it" |
| [Community catalog discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/1045) | `deepseek-harness-community-catalog` for plugins and companion tools |

## Context: this space is already busy

The community catalog already lists several web-search providers, including `dsh-web-search-exa`,
`dsh-web-search-pro`, `dsh-free-web-search`, `dsh-tavily`, `sheep-programmer/dsh-web-search-free`,
and `SeerableOfficial/dsh-web-search-toggle`. This package's differentiators are worth stating up
front in the README:

- it covers **both** capabilities — `web_search` **and** `web_fetch` — in one bundle, where the
  others are search-only;
- it is a **provider on the official `ctx.web` seam**, not a replacement tool, so `dsh-tool-web`
  keeps owning the model-facing schema, citation formatting, and the result cap;
- the TinyFish APIs it uses are free at any wallet balance.

## Optional next steps

- **Ship tests.** Upstream provider packages carry a `tests/` directory; the workspace rig at
  `C:\workspace\tinyfish-dsh\verify\run.mjs` is a ready starting point. Making it runnable without a
  DSH install needs a Node resolve hook that maps the four `@deepseek-ai/*` imports to stubs, so the
  stubs can ship in the repo without a nested `node_modules`.
- **Add `README.i18n.yaml`** if you want the bilingual display metadata to match upstream layout.
- **A TypeScript port** (`src/` + `tsconfig.json`) would match upstream exactly and make a future PR
  trivial, should DeepSeek ever open external contributions.
- **CI**: a workflow running the offline half of the rig (everything except the live API sections)
  on push.
