# CPA ReAuth Helper

一个用于 CLIProxyAPI（CPA）/ CPA-Manager-Plus 的 Chrome 扩展：从管理页当前的“需要重新认证”筛选结果读取账号，在扩展侧边栏编排 OAuth 重新认证，并在认证后刷新对应账号额度。

## 功能

- 直接读取 CPA-Manager-Plus 页面已筛选、已渲染的账号 DOM；不扫描认证文件、不解析 token，也不在扩展中重新判断认证状态。
- 支持单账号、所选账号和全部账号重新认证。
- 默认在最小化的无痕窗口中自动完成邮箱验证码流程；遇到人机验证或需要人工选择时弹出窗口并提示。
- 从 Cloud Mail 检查并填写新的邮箱验证码；不填写账号密码。
- 认证成功后刷新管理页中该账号的额度，再继续队列中的下一账号。
- 在侧边栏显示认证进度、错误和邮件诊断；管理页刷新后队列仍由扩展后台继续执行。

## 安装

1. 使用 Chrome 116 或更新版本。
2. 从本仓库的 [Releases](https://github.com/wan19970127/CPAReAuth/releases) 下载最新扩展 ZIP 并解压。
3. 打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择解压目录中的 `extension` 文件夹。
4. 在扩展详情中开启“允许在无痕模式下运行”。
5. 打开 CPA-Manager-Plus 的 `management.html` 账号页，在“运行状态”中选择“需要重新认证”。打开扩展侧边栏并扫描当前管理页。
6. 在扩展设置中配置 Cloud Mail 地址和管理员账号，并按提示授权扩展访问对应站点。

管理页需保持打开，以便逐账号刷新额度。批量任务开始前，请关闭其他无痕窗口；待认证账号需要有可读取的邮箱地址。

## 开发者说明（可选）

普通使用者无需运行构建脚本。开发者可在 Windows PowerShell 中运行构建和回归测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_extension.ps1
```

脚本会检查 JavaScript 语法，并运行 DOM 扫描、验证码、OAuth 回调、多账号队列及额度刷新回归测试。构建 ZIP 输出到本地 `dist/` 目录；该目录不纳入 Git，发布 ZIP 通过 GitHub Releases 分发。

## 权限与数据

扩展使用 Chrome 的 `storage`、`tabs`、`webNavigation`、`alarms`、`scripting` 和 `sidePanel` 权限来保存设置/队列、编排无痕认证并读取管理页筛选结果。CPA API 地址和 Cloud Mail 配置由用户在连接页面或扩展设置中提供。OAuth 回调仅在本地 `localhost:1455` / `127.0.0.1:1455` 导航中检测，并在会话 `state` 匹配后提交给 CPA；侧边栏日志不输出完整回调 URL、授权码或 state。

扩展不会把账号列表上传到本项目或第三方服务。管理页和 Cloud Mail 的网络请求仅用于用户配置的认证及额度刷新流程。

源码位于 `extension/`；开发构建及测试工具位于 `scripts/`。
