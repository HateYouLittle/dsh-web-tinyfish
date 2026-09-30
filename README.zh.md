# dsh-web-tinyfish

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 [TinyFish](https://docs.tinyfish.ai/)
**搜索**与**抓取** provider，为内置的 `web_search` 与 `web_fetch` 工具提供后端。

| 工具 | seam 方法 | 注册表 | TinyFish 端点 |
|---|---|---|---|
| `web_search` | `ctx.web.search()` | search | `GET https://api.search.tinyfish.ai` |
| `web_fetch` | `ctx.web.fetch()` | fetch | `POST https://api.fetch.tinyfish.ai` |

一个 bundle、两条 plugin row。DSH 自带 `deepseek-official`（搜索，`@deepseek-ai/dsh-web-search-deepseek`）
和 `http`（抓取，`@deepseek-ai/dsh-web-fetch-http`）；web seam 本身可插拔，本 bundle 给**两个注册表**
各加一个 `tinyfish` provider，并把两个设置都 pin 过去。自带的 provider 保持安装状态，因此回退只需改一行配置。

两条 row 都注册在 id `tinyfish` 下 —— seam 的 search / fetch 是两张独立注册表，不会冲突，一个名字覆盖两种能力。

## 为什么用 TinyFish

TinyFish 的 Search 与 Fetch 在任何余额下都免费（账号只需开通 API 访问权限）。与 DSH 自带的匿名本地 HTTP
抓取相比，TinyFish fetch provider 多了：

- **JavaScript 渲染** —— SPA、脚本驱动的文档站能拿到真实内容，而不是空壳；
- **反爬处理** —— 被拦的页面以明确的 `bot_blocked` 错误呈现，而不是把挑战页正文交给模型；
- **PDF 文本提取** —— 本地 provider 完全不支持 PDF；
- **免清洗正文提取** —— 直接返回干净的 Markdown（或 HTML/JSON）和页面元数据，而不是需要下游转换的原始 HTML。

代价是：抓取的 URL 会发给 TinyFish，而不是从你自己机器发起。TinyFish 会拒绝私网 IP、localhost 和云
metadata 端点，所以本地 provider 提供的 SSRF 防护依然在，只是改由 TinyFish 服务端执行。抓敏感地址时把
`fetchProvider` 改回 `http` 即可。

## 安装

需要 DSH 和一枚 TinyFish API key（在 https://agent.tinyfish.ai/api-keys 创建）。

```sh
dsh plugin --profile <profile> add dsh-web-tinyfish
```

profile **必须已存在** —— 这个 CLI 会先 boot profile 再执行命令。Desktop 托管的 `desktop` profile
CLI 会拒绝操作，请改用 Web 界面：**Plugins → Add plugin**，填 `dsh-web-tinyfish`，然后 **Enable now**。
安装即应用该 bundle 的 patch 层，它会注册两个 provider 并把 `web.searchProvider` / `web.fetchProvider`
pin 到 `tinyfish`。

> **请在安装前或安装时就把 key 配好。** 因为 bundle 会 pin 这两个设置，若某个 profile 里没有 key
> （`TINYFISH_API_KEY` 凭据、环境变量或私有配置覆盖），两个 provider 都会报不可用，`web_search` 与
> `web_fetch` 会以 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 失败。回退只需一行：把 `web.searchProvider`
> 改回 `deepseek-official`、`web.fetchProvider` 改回 `http`。

### 提供 API key

本包**刻意不携带任何 API key**。provider 按以下顺序解析：

1. 行配置里的字面量 `apiKey`；
2. 凭据服务中由 `apiKeyEnv`（默认 `TINYFISH_API_KEY`）指定的条目；
3. 启动进程的 `TINYFISH_API_KEY` 环境变量。

推荐放进凭据服务。若想用配置字面量，请写在**私有**覆盖里而不是本包内 —— DSH 自己的用户层
（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）不会被发布，且在所有 bundle 层之后应用：

```yaml
- id: web-search-tinyfish
  config:
    apiKey: 'sk-tinyfish-...'
- id: web-fetch-tinyfish
  config:
    apiKey: 'sk-tinyfish-...'
```

Loader 的 patch 是整体替换该行的 `config`，所以只写 `apiKey` 的私有覆盖，其余字段会回落到本 bundle 的默认值。

## 配置

### Row `web-search-tinyfish`

| 字段 | 默认 | 含义 |
|---|---|---|
| `apiKey` | — | 字面量 key（`role: secret`），优先级最高 |
| `apiKeyEnv` | `TINYFISH_API_KEY` | 凭据引用与环境变量回退名 |
| `baseURL` | `https://api.search.tinyfish.ai` | 端点；`TINYFISH_SEARCH_BASE_URL` 同样可覆盖 |
| `purpose` | — | 为什么要搜索（≤ 2000 字符），可提升结果质量 |
| `location` | API 默认（`US`） | 国家/地区码，如 `HK` |
| `language` | API 默认（`en`） | 语言码，如 `zh` |
| `domainType` | `web` | `web`、`news` 或 `research_paper` |
| `recencyMinutes` | — | 时间窗口，1 … 5256000 |
| `page` | `0` | 结果页，0 … 10 |

### Row `web-fetch-tinyfish`

| 字段 | 默认 | 含义 |
|---|---|---|
| `apiKey` | — | 字面量 key（`role: secret`） |
| `apiKeyEnv` | `TINYFISH_API_KEY` | 凭据引用与环境变量回退名 |
| `baseURL` | `https://api.fetch.tinyfish.ai` | 端点；`TINYFISH_FETCH_BASE_URL` 同样可覆盖 |
| `format` | `markdown` | `markdown` → seam 的 text body；`html` → seam 的 html body（由工具转换） |
| `ttl` | `0` | 缓存新鲜度（秒）；`0` = 每次实时抓取 |
| `perUrlTimeoutMs` | — | 单 URL 超时预算，1 … 110000 ms |
| `maxBodyChars` | `100000` | 正文上限；超出会截断并置 `truncated` |
| `purpose` | — | 为什么要抓这个页面 |

### seam 的 pin

bundle 还会覆盖 DSH 自己的 `web` 行。该覆盖整体替换 `config`，因此两个自带字段都要重述：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tinyfish   # 原为 deepseek-official
    fetchProvider: tinyfish    # 原为 http
```

## 行为

### 搜索

- 把 TinyFish 单页结果映射为 seam 的 source：`title` → `title`、`snippet` → `snippet`、`date` → `publishedAt`；
  无 URL 的条目丢弃，URL 去重。
- 自身不做截断：`web_search` 会把 `maxResults`（默认 8）传给 seam，由 seam 负责截断并置 `truncated`。

### 抓取

- `format: markdown` 映射为 seam 的 `kind: "text"`，工具直接透传文本，不做 HTML→markdown 转换；
  `format: html` 映射为 `kind: "html"`。
- `url` 取跳转后的 `final_url`；成功时 `statusCode` 为 `200`。
- TinyFish 把每个 URL 的失败放在 HTTP 200 的 `errors[]` 里，而 seam 的建模方式不同，因此本 provider 做了转换：
  - `page_not_found` / `target_http_error` 带有源站状态码。seam 把非 2xx 的源站响应当作**结果**，所以这两类会变成
    带该 `statusCode` 的结果，并附一段说明正文 —— 模型看到的是 `Fetched … (HTTP 404)`，而不是不透明的失败；
  - 其余每 URL 错误码变成带类型的 `WebError`：`timeout` → `WEB_FETCH_TIMEOUT`、`content_too_large` →
    `WEB_FETCH_TOO_LARGE`、`invalid_url` → `WEB_INVALID_URL`、`invalid_redirect_url` → `WEB_BLOCKED_URL`，
    以及 `bot_blocked`、`login_required`、`target_unreachable`、`proxy_error`、`empty_content`、`selector_*`
    → `WEB_PROVIDER_ERROR` 并附原因说明。

### 两者共同

- 失败都是带类型的 `WebError`：取消 → `WEB_ABORTED`；解析不到 key → `WEB_PROVIDER_CREDENTIAL_MISSING`；
  HTTP／传输／响应体无法表示 → `WEB_PROVIDER_ERROR`。401/402/403/429/503 的消息会带上对应的恢复建议。
- 携带凭据的请求都设置了 `redirect: "error"`，重定向响应会在 API key 可能被转发到其他源之前就被拒绝。

## 兼容性

本包**不声明任何依赖**。`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-credentials`、
`@deepseek-ai/dsh-launch-environment` 都由 DSH 安装本身携带，并通过 DSH 的 runtime resolution 提供给 profile
代码，因此从已安装的 bundle 里 import 它们无需重新安装。

DSH 处于 developer preview 阶段，官方明确预告会有破坏性变更。社区包如果按已发布的 npm 版本去 pin `@deepseek-ai/*`
的 peer，很容易触发 DSH 的插件兼容性检查（安装的 runtime 通常领先于已发布版本线），这也是本包不声明依赖的原因。

## 验证

安装后，**Plugins** 页面该 bundle 下应能看到两条 row。然后：

- 用任意查询跑 `web_search` —— 结果应引用 TinyFish Search 返回的真实 URL；
- 对一个 JavaScript 较重的页面跑 `web_fetch` —— 返回正文应是干净的 Markdown，而不是原始标记；
- 想端到端确认抓取链路，可把 `baseURL` 指向一个本地服务，抓取后观察那个带
  `{"urls":[...],"format":"markdown","ttl":0}` 的 `POST` 请求。

## 许可证

MIT
