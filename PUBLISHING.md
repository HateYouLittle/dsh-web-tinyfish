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

## 3. Publish to npm

`dsh-web-tinyfish` is unscoped, so no `--access` flag is needed:

```sh
npm login
npm publish
```

If you would rather publish under a scope, rename the package to `@you/dsh-web-tinyfish`, update the
two `name:` specifiers in `cordis.patch.yml` to match, and publish with `--access public`. The row
`name` values **must** equal the installed package name, otherwise the Loader cannot import the rows.

## 4. Repository — created, first push done

The repository exists and is public; the first commit is pushed to `main`. Later changes:

```sh
git add -A && git commit -m "…"
git push
```

The remaining manual step is the topic: **GitHub → About → Topics → `dsh-plugin`** (the REST API needs
a token, so it is not scripted here). That is the discovery mechanism DeepSeek points at, and the
community catalogs aggregate it.

## 5. How users install it

```sh
dsh plugin add dsh-web-tinyfish
dsh plugin --profile web add "github:HateYouLittle/dsh-web-tinyfish#main"
```

Or in the Web UI: **Plugins → Add plugin** → the package name or repo spec → **Install** → **Enable now**.

Only packages declaring `dsh.bundle.patch` become active profile layers — this one does. A plain
dependency installs but stays inactive.

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
