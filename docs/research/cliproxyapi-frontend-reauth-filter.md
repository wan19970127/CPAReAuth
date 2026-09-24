# CLIProxyAPI Management Center：认证列表筛选与“重新认证”能力调研

调研日期：2026-09-22  
CPA 基线：[router-for-me/CLIProxyAPI `main` @ `555662940411a07460e9d24d14477a5f50dffdb5`](https://github.com/router-for-me/CLIProxyAPI/tree/555662940411a07460e9d24d14477a5f50dffdb5)  
Management Center 基线：[router-for-me/Cli-Proxy-API-Management-Center `main` @ `4530da271ba2e89810d4dccebc57f3091afa590a`](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/4530da271ba2e89810d4dccebc57f3091afa590a)

## 结论

当前 CPA **没有**公开的“需要重新认证”状态、字段或只返回这类账号的 Management API。官方 Management Center 也没有这个筛选；它仅实现了名为 `problem`（问题凭证）的前端启发式筛选。

因此不能将官方控制台的 `problem` 逻辑移植到本插件后称为“CPA 已判定需要重新认证”：该逻辑会把暂时不可用、`error` 和任意非健康文案均归入问题，属于控制台自行判断，并不等价于持久认证失效。

严格满足“只使用 CPA 已有状态筛选需要重新认证的账号，不自行判断”的可行方案是：插件只消费 CPA 将来明确提供的 `reauth_required`（或等价的、版本化的）字段/端点。在该契约尚不存在的当前版本，插件不能可靠地产生“仅需重新认证账号”列表；最保守的表现应是空列表和明确的接口能力提示，而不是回退扫描认证文件、解析 token 或复制 `problem` / `classify()` 规则。

## 前端源码不在 CPA 主仓库

CPA 的示例配置将控制台指定为独立仓库 `router-for-me/Cli-Proxy-API-Management-Center`；CPA 的管理资产更新器则从该仓库的 release 下载单个 `management.html`。所以分析控制台的实际筛选必须固定 Management Center 的提交，而不能在 CPA 主仓库中寻找 React/TypeScript 源码。

- [控制台仓库配置](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/config.example.yaml#L25-L33)
- [release 下载地址、资产名 `management.html`](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/managementasset/updater.go#L28-L39)
- [管理资产自动更新时采用该配置仓库](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/managementasset/updater.go#L80-L103)

## 官方控制台实际做了什么

### 筛选名称与定义

Auth Files 页面的状态筛选枚举只有 `all`、`enabled`、`disabled`、`problem`，没有 `reauth`、`needs_reauth` 或 `REAUTH_REQUIRED`。`problem` 通过前端函数 `isProblemAuthFile` 判定，含义如下：

```ts
if (file.disabled === true || status === 'disabled') return false;
return file.unavailable === true || status === 'error' || hasAuthFileStatusWarning(file);
```

其中 `hasAuthFileStatusWarning` 只把 `ok`、`healthy`、`ready`、`success`、`available` 当作健康消息；所有其它非空 `status_message` 都属于告警。因此它包含 CPA 的短暂错误、限额/冷却等非认证故障，不能作为本插件的“需重新认证”成员条件。

- [`problem` 的完整客户端判定](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/constants.ts#L119-L149)
- [状态筛选的完整枚举](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/uiState.ts#L1-L10)
- [实际下拉选项与 `problem` 分支](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/AuthFilesPage.tsx#L191-L193)；[筛选应用位置](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/AuthFilesPage.tsx#L391-L409)

### 数据流、刷新和分页

控制台获取的是完整的 `/auth-files` 结果，再在浏览器内依次做状态、provider、搜索和排序筛选，最后以 `slice` 分页。它不会向 CPA 请求“问题”或“重新认证”子集。

```text
AuthFilesPage
  -> useAuthFilesData.loadFiles()
  -> authFilesApi.list()
  -> GET /v0/management/auth-files
  -> CPA Handler.ListAuthFiles()
  -> 浏览器内 problem / provider / search / sort / slice
```

- [`loadFiles` 无参数调用 `authFilesApi.list()` 并保存全量 `files`](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/hooks/useAuthFilesData.ts#L190-L219)
- [`list()` 未传 lookup 时仅 GET `/auth-files`](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/services/api/authFiles.ts#L435-L442)
- [首载/页面激活拉取与每 240 秒后台拉取](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/AuthFilesPage.tsx#L355-L378)
- [provider、搜索、排序与浏览器端 `slice` 分页](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/AuthFilesPage.tsx#L435-L456)
- [界面状态只持久化到浏览器 storage，不是认证列表缓存](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/uiState.ts#L40-L74)

控制台的“手动刷新”也不是筛选或重新认证判定：它调用 `POST /auth-files/refresh`。前端刻意把可能带有 token 的返回体丢弃，说明不需要也不应从该响应解析 token。

- [手动刷新动作](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/features/authFiles/hooks/useAuthFilesData.ts#L488-L524)
- [刷新响应不返回给调用方的实现](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/4530da271ba2e89810d4dccebc57f3091afa590a/src/services/api/authFiles.ts#L450-L456)

## CPA Management API 的实际能力

CPA 注册的认证相关路由包括 `GET /auth-files`、状态编辑、字段编辑、`POST /auth-files/refresh` 和 OAuth 会话接口；没有“仅 reauth-required”路由。`GET /get-auth-status` 是 OAuth 会话轮询，不是账号认证状态列表。

- [路由注册](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/server_management.go#L179-L199)
- [`get-auth-status` 查询 OAuth session 状态的实现](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files_provider_oauth.go#L929-L1004)

`ListAuthFiles` 从 CPA 运行时 `authManager.List()` 构建响应。它仅接受 `name`、`auth_index`、`page`、`page_size`：前两者是已知账号的精确 lookup，后两者只是把全体结果分页；不支持 `status`、`unavailable`、provider 或 reauth 过滤。未传分页参数时返回全部账号。

- [运行时枚举、已支持 query 参数和未分页全量响应](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L103-L174)
- [分页参数及响应字段](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L176-L226)
- [`name` / `auth_index` 的精确匹配规则](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L292-L303)
- [CPA 输出的 `auth_index`、`email`、provider、状态、不可用及配额字段](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L637-L727)

`status` 也不是 reauth 专用状态。CPA 的状态集含 `unknown`、`active`、`pending`、`refreshing`、`error`、`disabled`，其中 `error` 的官方语义是暂时因错误不可用；`Unavailable` 同样会用于配额耗尽等情形。因此仅用公开 `status`、`unavailable` 或 `status_message` 再做客户端组合，依旧是在插件侧复制一份认证判断。

- [认证状态常量与 `error` 语义](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/sdk/cliproxy/auth/status.go#L3-L19)
- [`Unavailable` 对暂时不可用/配额耗尽的说明](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/sdk/cliproxy/auth/types.go#L67-L84)

CPA 内部确实会识别终态未授权、access token 已过期和 `token expired` 等持久认证失败，再把它们映射到公开的 `unavailable=true, status=error`；但同一公开组合也会由有效 cooldown / 模型 cooldown 产生。内部区分所需的错误和 token 状态没有作为版本化的“需重新认证”字段输出，所以客户端无法从该响应无歧义地还原这一判断。

- [内部持久认证失败判定及其公开状态映射](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L487-L550)
- [cooldown 同样映射为 `unavailable=true, status=error`](https://github.com/router-for-me/CLIProxyAPI/blob/555662940411a07460e9d24d14477a5f50dffdb5/internal/api/handlers/management/auth_files.go#L597-L634)

## 对本插件的实施约束

1. 删除所有 `host.auth.list`、`host.auth.get_runtime`、`host.auth.get`、认证文件扫描、token 解码/过期检查、`classify()` 和对 `REAUTH_REQUIRED` 的假设。
2. 不得把 Management Center 的 `problem` 规则复制进插件；它是前端 heuristic，并非 CPA 声明的“需重新认证”。
3. 若上游新增明确契约，插件仅请求并展示 `provider == "codex" && reauth_required == true` 的 CPA 返回项目，以 `auth_index` 标识账号；单账号、全部账号和无痕 OAuth 流程均只针对该返回集合操作。
4. 在当前上游版本没有该契约时，保持列表为空并展示“当前 CPA Management API 未提供重新认证账号列表”的说明；不要以全量 `/auth-files` 加本地筛选作为替代。

若产品必须在当前 CPA 版本即时可用，则需求需要先扩展 CPA：例如公开 `reauth_required: boolean`、`reauth_reason`，或提供 `GET /v0/management/auth-files/reauth-required`。该字段/端点必须由 CPA 内部的持久认证失败逻辑计算，并明确排除 quota、cooldown 和暂时性错误；之后插件只消费其结果，才能满足“CPA 已有状态”的边界。
