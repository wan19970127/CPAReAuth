# CPAMP“需要重新认证”运行状态调研

调研日期：2026-09-22。源码固定到 [seakee/CPA-Manager-Plus](https://github.com/seakee/CPA-Manager-Plus) `main` 的提交 `1fa5e8a79ce067350d9a5ba6dd5a7b1843cc77f4`。

## 确切前端条件

CPAMP 的凭证页并没有把 `status == error` 当作“需要重新认证”。`apps/web/src/features/accounts/model/accountRows.ts` 中，运行状态 `reauth` 会调用 `authFileMatchesCodexStatusFilter(status, 'reauth')`，并且拒绝存在较新正向请求证据的账号。

`apps/web/src/features/authFiles/model/credentialStatus.ts` 中，`needsReauth` 是 `selectCurrentAuthenticationFailure(...) !== null`。该函数按时间选择当前仍有效的负向认证证据，较新的成功、额度或健康证据会覆盖旧认证错误。认证失败证据包括：

- HTTP 401；
- `reauth` 检查动作；
- 公共错误文本中的认证失效语义，如 `authentication_error`、`auth_unavailable`、无效/过期/revoked token 或 refresh token。

同一文件将 `usage_limit_reached`、402、429、配额已满和健康证据视为正向凭证证据或独立额度状态，不应作为重新认证。

CPAMP 的该路径**不会读取或判断** `next_retry_after`；它不是“需要重新认证”的排除条件。线上核对中，CPAMP 显示的待认证条目都带此字段，因此 V0.2.2 的本地排除逻辑会将其错误清空。V0.2.3 已移除此排除。

## 数据路径与边界

CPAMP 的 `apps/web/src/services/api/authFiles.ts` 的 `authFilesApi.list()` 请求 `/auth-files`，而 `apps/web/src/features/authFiles/hooks/useAuthFilesData.ts` 将响应保存在前端内存。`AccountsPage.tsx` 还合并了：

- CPA `auth-files` 运行时字段；
- CPAMP 检查记录；
- 请求头快照和本地额度状态；
- 较新的成功请求证据。

因此截图中的筛选是 CPAMP 前端的派生视图，不是 CPA Management API 中的 `reauth_required` 字段或服务端的已筛选集合。

CPA 的 `GET /v0/management/auth-files` 当前仅支持 `name`、`auth_index` 及分页；CLIProxyAPI 没有 `reauth` / `needs_reauth` / `runtime_status` 查询参数，也没有只返回该子集的 Management API。CPAMP manager-server 路由也没有暴露等价的只读“需重新认证账号列表”端点。

结论：在上游新增该端点前，插件无法同时满足“完全复用 CPAMP 全部证据链”和“只从服务端取得已筛选子集”这两个要求。要严格满足后者，应由 CPA 或 CPAMP 服务端提供例如 `GET /v0/management/auth-files?runtime_status=reauth` 的稳定协议，并在服务端实现上述证据优先级；插件只能消费该端点并以 `auth_index` 启动认证。
