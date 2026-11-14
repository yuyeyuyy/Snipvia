# 官网 Release 同步工作流验收

日期：2026-11-14。实施仓库为独立公开客户端候选 `/Users/macbook/IdeaProjects/Snipvia-public-baseline`，开始时工作区干净，分支 `refactor/snipvia-v2`，HEAD 为 `a0062eed9932ac1849da3ec13e1f186f026df157`。

## 交付范围

按用户选择实现“正式 GitHub Release 发布 → 核验三平台成品 → 通过官网 API 上传并统一上架”。没有重做本机签名、Windows 构建或 GitHub Release 创建环节；没有升级依赖、更改桌面功能、安装目录、用户数据或官网服务器。

用户随后明确授权提交推送与启用。GitHub 的 `website-production` 环境已创建，仅允许 `main` 分支与 `v*` 标签，现有官网专用发布凭据已通过标准输入交由 `gh` 加密保存为环境 Secret `WEBSITE_RELEASE_TOKEN`。凭据值未进入命令参数、日志或代码，其他密钥和服务器配置不变。本次提交交付自动同步工作流；未创建新 Release、重新打包或执行托管 Actions。当前官网仍是上一轮已部署的 v1.0.2。

## 验证记录

| 验证 | 实际结果 |
| --- | --- |
| `pnpm lint` | 通过；后续仅进度日志和输出标签调整的脚本也增量通过 ESLint |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 54 个文件、316 项通过，包含 7 项新增工作流/传输测试；未跳过既有测试 |
| `actionlint 1.7.12` | 新工作流语法与表达式通过；工具仅在任务临时目录使用，归档 SHA-256 已与官方 Release digest 核对；未启用本机未安装的外部 ShellCheck/Pyflakes |
| 当前 Release 只读计划 | 实际解析 GitHub v1.0.2、最新正式版本与标签源码 `0602b725a92b47076b882b02a39aeaf2042d8e79`，没有下载或修改官网 |
| 两种 Mac 的真实检查 | 对本机已发布 v1.0.2 成品逐一核对字节并执行新工具的签名、Staple、Gatekeeper、包内版本与架构检查，arm64/x64 均通过；只读挂载，未执行 APP |
| 完整准备链演练 | 使用实际 GitHub v1.0.2 和 Windows Run `43437359356`，下载原始 CI 产物，核对同仓库/源码、成功安装/运行/卸载步骤、构建元数据及实际 EXE；下载两个正式 DMG 并再次经工具检查，完整生成 `PUBLICATION.json` |
| 收据与正式发行比对 | 演练收据的源码 SHA、三包名字、大小和 SHA-256 均与既有 `V1_0_2_PUBLICATION.json` 一致 |
| 上传与重试 | 复用上一轮已上线的独立传输工具；新增本地 HTTP 测试实际执行工具，验证三包上传、统一发布、重试跳过、坏包在首个请求前拒绝及凭据不回显；本轮未再次向官网上传 |
| 差异检查 | `git diff --check` 通过；`src/`、原生代码、构建配置和锁文件未修改 |

完整准备演练仅写入任务临时目录，没有更改 GitHub Release 或官网。保存收据后，已删除本轮临时下载的安装包和 Windows CI 解压副本；原正式产物保持原样。

## 文件级变更

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/website-release.yml` | 正式 Release 自动触发、默认分支手动重试、全局串行、限权环境、分阶段密钥注入、仅归档核验收据 |
| `scripts/release/prepare-website-sync.mjs` | 固定仓库/最新稳定版规则、Release 摘要、Windows 实际证据链、Mac 系统验证、收据和发布前一致性复核 |
| `scripts/publish-website-release.mjs` | 复用上一轮通用独立发布工具，不含私有服务代码；预检、流式上传、幂等发布及公开 API 核对 |
| `package.json` | 新增 `website:sync:prepare`、`website:publish` 两个命令；版本和依赖不变 |
| `tests/unit/website-sync.test.ts` | 非正式版本/注入/缺包/坏摘要、跨仓库或跨提交 Windows 证据、跳过的验收、实际文件不匹配、Mac 信任/清理边界及工作流密钥隔离 |
| `tests/unit/website-publisher.test.ts` | 临时 HTTP 服务验证真实 Node 上传工具、重复执行、预检失败与日志安全 |
| `docs/WEBSITE_RELEASE_WORKFLOW.md` | 流程、首次启用、Secret 安全设置、重试、证据过期与恢复、权限及限制 |
| `docs/MACOS_RELEASE.md` | 增加独立官网同步入口链接，不改变原签名或发布授权边界 |
| 本文件 | 本轮实际验收与尚未验证事项 |

## 安全与恢复

工作流无 Git、标签或 Release 写入权限。密钥仅在上传步骤写入 runner 临时 600 文件，退出清除，不写源码、输出、缓存或 Actions 产物。Fork 不执行官网部署；手动输入经严格稳定版本/数字 Run ID 校验，传入环境和参数，不拼接为 Shell 代码。所有第三方 Actions 固定完整提交 SHA。

失败时旧完整版本和下载计数保留；草稿与部分上传可安全重试，同版本不同文件拒绝覆盖。DMG 卸载失败时保留挂载点，禁止递归删除挂载卷。移除/禁用本工作流只停止后续自动同步，不影响已部署官网、旧安装包、下载统计或客户端 GitHub 更新。

任务保全与日志目录：`/Users/macbook/.codex/visualizations/2026/10/16/01a142ea-f39a-79c1-8848-cd980a16141b/release-workflow-20261114`，包含修改前状态与受影响文件副本、检查日志、真实演练日志和公开收据，不含实际发布密钥。私有工程原有未提交改动未提交或覆盖。

## 尚未执行与首次启用条件

- GitHub 环境、来源限制与专用 Secret 已实际配置，并按用户授权提交到默认分支；本轮未运行托管 Actions，不能写成“线上自动工作流已通过”。
- 本机完整核验通过不能替代 `macos-15` 托管 runner 的首次运行记录；启用后可对当前最新正式版本进行一次幂等同步，核对环境权限和实际官网网络链路。
- Windows 原始 CI 产物当前保留 7 天。过期会明确失败，不重建不同字节冒充原包；应保存核验收据，必要时按操作文档使用独立工具恢复。
- 未重新执行桌面回归、签名、公证、真实用户权限变更或客户端安装；本轮没有改变这些输入。

操作步骤见[官网发布工作流](../WEBSITE_RELEASE_WORKFLOW.md)。
