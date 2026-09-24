# CLIProxyAPI：重新认证账号的 Management API 调研

调研日期：2026-09-22  
上游仓库：[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)  
核对基线：默认分支 `main`，提交 [`555662940411a07460e9d24d14477a5f50dffdb5`](https://github.com/router-for-me/CLIProxyAPI/tree/555662940411a07460e9d24d14477a5f50dffdb5)（由 `git ls-remote` 于本次调研取得）。

## 结论

1. 当前上游的运行时权威数据源是管理接口 `GET /v0/management/auth-files`，而不是 `auth-dir`、认证 JSON、JWT/token，亦不是插件 host 的 auth API。该接口由 CPA 的 `AuthManager` 读取运行时 `Auth`，并在输出前由 CPA 自身做状态协调。
2. 这个版本**没有**名为 `REAUTH_REQUIRED`、`reauth_required` 或“仅列出需重新认证账号”的 Management API 路由/返回字段，也没有按状态筛选的 query 参数。已实现的 `GET /auth-files` query 参数只有 `name`、`auth_index`、`page`、`page_size`。
3. `GET /auth-files` 每个账号可获得 CPA 已计算的 `status`、`status_message`、`unavailable`、`cooldowns`、`next_retry_after`、`quota` 和稳定标识 `auth_index`；账号身份应使用 `auth_index`，邮件应使用 `email`。
4. 不能把 `status == "error"` 或 `unavailable == true` 等同于“需要重新认证”：官方源码明确将它们也用于配额耗尽、冷却、暂时上游错误和模型阻塞。`StatusError` 的官方注释就是“因错误暂时不可用”。
5. 若需要精确覆盖 CPA 内部的全部持久认证失败分支，仍需要上游公开专用字段/端点。对本次核验的部署，`status_message` 公开了结构化 `authentication_error` / `auth_unavailable`，而额度耗尽为 `usage_limit_reached`；插件可只消费前者，并保留 CPA 精确的 `token expired` 状态，从而不把额度耗尽纳入重新认证列表，且不复制 token/过期时间判断。

## 已有可用接口

### `GET /v0/management/auth-files`

请求需要 Management Key，例如：

```bash
curl -H 'Authorization: Bearer <MANAGEMENT_KEY>' \
  'http://localhost:8317/v0/management/auth-files'
```

当运行时 AuthManager 可用时，接口枚举 `h.authManager.List()`；它不是从插件读取认证文件。分页响应为 `{ "observed_at", "files", "pagination" }`，未分页时为 `{ "observed_at", "files" }`。

与重新认证编排有关的单个 `files[]` 字段：

| 字段 | 用途 / 语义 |
| --- | --- |
| `auth_index` | CPA 生成的稳定运行时凭证标识。用于后续按账号动作，不能以文件名替代。 |
| `email` | CPA 提取并输出的邮箱；缺失时字段不出现。 |
| `provider` / `type` | 提供方；本插件应仅处理 `codex`。 |
| `status` | CPA lifecycle state，如 `active`、`error`、`disabled`。不是 reauth 专用枚举。 |
| `status_message` | CPA 当前运行时状态的简短信息。不是稳定的 reauth 专用协议字段。 |
| `unavailable` | CPA 当前不可用标记；包括暂时失败和配额情形，不能单独当作需重新认证。 |
| `cooldowns` | CPA 生成的 credential/model 运行时冷却记录。可辅助诊断 `429` / `quota` / `credential_quota`，但不作为本插件的重新认证成员条件。 |
| `next_retry_after`、`quota`、`model_quotas` | CPA 的重试、配额、模型运行时状态。 |

直接源码证据：

- [路由注册：`GET /auth-files`](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/server_management.go#L179)
- [`ListAuthFiles` 从 `authManager.List()` 读取运行时 auth，并只接受 `name` / `auth_index` lookup](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L103-L173)
- [返回字段构造](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L637-L727)
- [官方 Management API 文档：Auth File Management](https://help.router-for.me/management/api#auth-file-management)

## 状态语义与不能自行推断的原因

CPA 的状态常量是 `unknown`、`active`、`pending`、`refreshing`、`error`、`disabled`；没有 `REAUTH_REQUIRED`。尤其 `error` 的注释是“temporarily unavailable due to errors”。

- [状态常量和语义](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/sdk/cliproxy/auth/status.go#L3-L19)
- [`Auth.Unavailable` 注释：暂时提供方不可用，例如配额耗尽](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/sdk/cliproxy/auth/types.go#L67-L84)

CPA 内部有一个未导出到 Management JSON 的 `isPersistentAuthFailure`：它会将终态 401、access-token 已过期、或状态消息为 `token expired` 识别为持久认证失败，并令 API 响应变为 `unavailable: true, status: "error"`。但相同的公开组合也会表示其它不可用状态；此外该函数使用 `LastError`、访问令牌过期时间等字段，而这些字段没有出现在 `files[]` 响应中。

- [CPA 内部持久认证失败规则及协调逻辑](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L487-L550)
- [终态 unauthorized 的内部定义](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/sdk/cliproxy/auth/conductor_cooldown.go#L1656-L1670)
- [CPA 对 401、429、5xx 分别都写入 `StatusError`/`Unavailable`](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/sdk/cliproxy/auth/conductor_cooldown.go#L2155-L2249)
- [官方测试：过期 token 输出同样是 `unavailable=true,status=error`](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files_cooldown_test.go#L267-L314)
- [官方测试：access token 过期但 `status_message` 可仍是 `credential_quota`](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files_cooldown_test.go#L576-L629)

最后一个测试排除了仅按 `status_message` 建白名单的方案：认证确实已失效，但公开消息仍可能是 `credential_quota`。因此插件若解析 token、比对过期时间、解析 `status_message` 文本，或复制 CPA 的 `LastError` 判定，都会重新引入被禁止的本地认证状态判断。

## 对插件改造的建议

### 当前部署的可用筛选（不扫描认证文件、不解析 token）

将帐号来源改为分页 Management API `GET /v0/management/auth-files`。只保留 `provider == "codex"`、`status == "error"`、`unavailable == true`、无 `next_retry_after`，且 CPA `status_message` 中的公开结构化错误为 `type == "authentication_error"`、`code == "auth_unavailable"` 的条目；CPA 精确输出 `token expired` 时也保留。排除 `usage_limit_reached`、`429` / `quota` / `credential_quota`。单账号和批量操作随后均传递 `auth_index`，以避免重新按文件名发现账号。

### 严格满足“CPA 已判定需要重新认证”所需的上游契约

需要 CPA 提供一个明确、版本化的公开契约，例如：

```json
{
  "auth_index": "…",
  "email": "user@example.com",
  "provider": "codex",
  "reauth_required": true,
  "reauth_reason": "persistent_auth_failure"
}
```

或独立的 `GET /v0/management/auth-files/reauth-required`。该端点/字段必须由 CPA 内部 `AuthManager` 及其持久认证失败逻辑计算，并明确排除 quota/cooldown/transient error。插件只转发 CPA 的名单，既不读取 auth 文件，也不解析/分类 token 或假设 `REAUTH_REQUIRED` 状态存在。

在 CPA 尚未提供此契约的版本，唯一不复制认证判断的保守选择是：不展示列表并清晰报告接口能力不足；不能伪称 `status=error` 是“需重新认证”。
