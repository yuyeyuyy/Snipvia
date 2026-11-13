# v1.0.2 更新网络修复与验证

## 问题和证据

用户在 v1.0.0 的设置页检查更新时看到“检查更新超时”。v1.0.0 与 v1.0.1 的更新检查代码相同：Main 没有注入网络传输，服务回退到 Node `fetch`，8 秒后取消请求。安装包下载已使用 Electron 网络，问题发生在发现版本这一段。

本机在相同的固定公开 GitHub 接口、8 秒预算和系统代理配置下测量：

| 请求路径 | 结果 |
| --- | --- |
| 原 Node fetch | 8,004 ms 后超时 |
| Electron net.fetch | 2,223 ms，HTTP 200，返回 v1.0.1 |
| 修复后真实 Main 调用链 | 2,257 ms，成功取得 v1.0.1；Node fetch 调用为 0，显示窗口为 0 |

真实 Main 验证使用临时数据目录，隐藏窗口、禁用快捷键注册与截图预热。测试代码版本为待发布的 1.0.2，服务器当时最新为 1.0.1，因此状态为 up-to-date；这条记录只证明版本请求恢复，不表示当时已经发布 1.0.2，也不证明下载和安装已执行。

网络栈行为参见 [Electron net 官方说明](https://www.electronjs.org/docs/latest/api/net)。

## 修复范围

- `src/main/index.ts`：Main 显式注入 Electron `net.fetch`，跟随系统代理和 PAC。
- `src/main/updates/UpdateCheckService.ts`：构造参数必须提供传输函数，移除隐式 Node fetch 回退。
- `tests/integration/updates.spec.ts`：合成响应由 Electron net 提供；禁止 Node fetch，请求仍必须不携带凭据、禁止重定向。
- `tests/integration/windows-release.spec.ts`：安装验证同时阻止 Node 和 Electron 的外部请求。
- `.github/workflows/windows-internal.yml`：Windows 桌面回归加入更新专项。
- `package.json` 与更新说明：准备 1.0.2 补丁，不覆盖 v1.0.0／v1.0.1。

不增加第三方依赖，不修改截图、编辑、收纳、快捷键、原生 Helper、应用标识或用户数据目录。保留固定仓库、8 秒超时与取消、256 KiB 响应上限、稳定版本校验、IPC 权限、签名与 SHA-512 安装校验。

## 已完成与后续门槛

- Lint 通过；最后补充的测试文件已增量检查。
- 类型检查与构建通过；52 个单测文件、309 项通过。
- 更新专项 Electron 集成测试 1 项通过，包括后台和手动检查、错误恢复、更新说明、下载与安装状态、亮暗主题及 IPC 隔离。
- 上表真实网络检查通过；没有操作当前安装版进程、用户截图或用户配置。
- Windows 安装版与正式 macOS 签名、公证、远端资产和公开更新入口结果，以最终发行验收记录及收据为准；本文件不提前将待执行检查写为通过。

## 升级边界

旧版进程不会因为服务器发布新版就自动获得客户端网络修复。已遇到本问题的 v1.0.0／v1.0.1 用户，需要从 GitHub Release 手动安装一次修复版；下载前先导出重要收纳截图。系统代理与 PAC 是否可用仍由本机网络决定，未增加第三方镜像或绕过 TLS 校验。

已发布版本和用户配置保留。需要回滚时使用独立版本和恢复记录，不覆盖既有 Release 资产或改写 Git 历史。

## 最终发行结果

v1.0.2 已正式发布。Windows、Mac 签名公证、远端资产、公开更新入口和发布后真实 Main 查询结果见[发行验收记录](V1_0_2_RELEASE.md)及[发布收据](V1_0_2_PUBLICATION.json)。
