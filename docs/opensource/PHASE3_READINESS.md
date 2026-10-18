# Snipvia Phase 3：发布前验收与安全收尾

日期：2026-10-16。唯一工作区：`/Users/macbook/IdeaProjects/Snipvia-public-baseline`。本轮依据维护者选择执行“发布前验收与安全收尾”，并采用 Apache License 2.0；原方案中已完成的 workspace 分离没有重复实施。

## 1. 结论与执行边界

**本地免费客户端验收通过；正式发行仍为 No-Go。** 源码公开可以进入维护者审阅，建议有条件 Go：确认本轮差异、依赖残留风险与历史图片隐私范围后，再单独决定公开。当前没有执行公开、推送、Release、生产签名、公证、更新安装或停服。

已落地许可证与第三方通知、隐私和贡献说明，修复远端 HTTP 缺少提示、设置页预测说明过时，以及未签名验证包错误宣称支持安装更新的问题。定向更新三个依赖版本。截图、预测、AI 对话、Agent、存储和 IPC 业务实现没有重新改写，也没有为未来商业化增加双版本架构。

正式发行剩余门槛：`lazy-val@1.0.5` 缺少可核实的完整许可证文本；生产依赖 `node-forge@1.4.0` 仍有高危公告；尚无新版本号、正式签名升级、Intel / Windows 和真实录屏验收。新更新仓库仍为 Private，匿名 Release API 不可用。后文逐项给出证据与验收标准。

工作分支为 `codex/phase3-readiness`，HEAD 保持 `ce46e1fff25ac7abae4f0e85f76393990042ceb8`，本轮差异未提交。没有修改 `Snipvia-legacy`、`Snipvia-server` 或原 `Snipvia/` 工作目录。

## 2. 保全与现有能力

开始前保存 `.dev-runtime/phase3/before.bundle`、暂存/未暂存 patch、状态清单及三份 Phase 2 改动原件和哈希。结束前逐项校验这三份内容未变：

- `docs/opensource/PHASE2_ACCEPTANCE.md`
- `tests/integration/local-first-compatibility.spec.ts`
- `tests/unit/editing-proposals.test.ts`

Phase 2 报告的历史结论保持原文，本报告记录后续变化。没有 reset、clean、历史重写或丢弃既有功能。

| 已实现并验证的能力 | 实际证据 | 本轮处理 |
| --- | --- | --- |
| 无账号启动、截图编辑、历史、笔记 | `src/main/index.ts`、`src/preload/index.ts`、`tests/integration/local-first.spec.ts`、`local-first-compatibility.spec.ts` | 保留；没有恢复账号初始化、资格 IPC 或会员入口 |
| 用户模型直接预测 | `src/main/analysis/PredictionService.ts`、Main 的预测调用链、`src/main/ai/provider.ts` | 保留；Main 快照当前设置和分支、读取系统保护 Key，再直接调用用户模型 |
| 预测输入与输出约束 | `src/main/ai/provider.ts`、`src/shared/screenshot-understanding.ts`、预测单元/集成测试 | 选中裁剪图与启用分支条件进入视觉模型；解析结果、匹配 ID、置信度仍校验；没有接回 Jev / TypeSafe 或旧代理 |
| 无 Key 的本地功能与明确模型提示 | `src/main/ai/model-configuration.ts`、上述兼容性用例 | 保留；免认证本地模型仍可使用，不新增登录要求 |
| v0.2.3 合成数据兼容、Key 跨重启 | `local-first-compatibility.spec.ts`、`tests/unit/settings.test.ts`、`history.test.ts` | 复验；未访问真实用户目录、删除旧数据或改迁移格式 |
| 权限与凭据边界 | Main 的窗口和 IPC 验证、`ProcessSandbox.ts`、文件授权测试 | 保留 contextIsolation、sandbox、参数校验、safeStorage、Agent 授权与路径限制 |
| 独立 GitHub 更新链路 | `src/shared/release-source.json`、`src/main/updates/`、`tests/integration/updates.spec.ts` | 保留匿名检查、哈希/版本/签名校验和用户明确安装；只修正内部包能力标识 |

Jev / TypeSafe 当前没有作为可选 Provider 接入，不能标记为已经实现；免费核心不依赖它们。官方账号服务断网测试使用启动前网络隔离和合成模型服务，真实供应商付费 API 未调用。

## 3. 本次修改及文件记录

| 文件 | 变更及原因 | 验收证据 |
| --- | --- | --- |
| `LICENSE`、`NOTICE`、`package.json` | Apache 2.0 原文、项目声明及 SPDX 标识；不把第三方内容重新授权 | LICENSE 与 Apache 官方原文哈希一致；应用包内保留 |
| `THIRD_PARTY_NOTICES.md` | 说明第三方原始许可、node-forge 的 BSD-3-Clause 选项与授权边界 | 与生成清单、实际包体对照 |
| `scripts/opensource/generate-notices.mjs` | 构建时从当前生产依赖生成完整原始通知、文件哈希与 Electron / Chromium 声明；不只输出许可名称 | 276 个生产包版本；包内 Electron 声明与安装依赖一致 |
| `package.json` 的 build 脚本、`electron-builder.yml` | 构建生成通知，打包包含 LICENSE / NOTICE / 第三方声明及 `out/licenses/` | 新内部 ASAR 逐文件哈希核对 |
| `scripts/macos-release/hooks.cjs` | 正式打包前拒绝缺少依赖许可文本的清单 | 当前 lazy-val 仍被生成器标为缺失；正式脚本未执行 |
| `electron-builder.macos-validation.cjs` | 内部未签名包显式 `snipviaAutoUpdate: false`，拒绝 CLI 重启用该标识 | 3 项实际配置测试及真实内部包启动状态 |
| `tests/unit/packaging-config.test.ts` | 验证内部包禁签名/公证/安装更新，正式配置仍要求签名、公证并启用更新 | 3 项通过；不调用 Apple 签名工具 |
| `src/shared/model-endpoint.ts` | 区分远端 HTTP 与 HTTPS / 明确 loopback，提供明文传输提示 | 13 项单元测试，包括 IPv4、IPv6、URL 规范化和无效输入 |
| `src/renderer/src/settings/SettingsPanel.tsx` | 模型卡片与配置框显示中性 HTTP 提示；将“预测使用后台配置”改成共用用户模型 | 保持已有黑白灰设置行结构；无 Key 暴露或保存格式变更 |
| `tests/integration/model-transport.spec.ts`、`tests/unit/model-endpoint.test.ts` | 旧 HTTP 配置可加载、远端提示、HTTPS / 本地兼容、未保存输入不写盘 | 新增 1 项 Electron、13 项单元测试 |
| `docs/ui/model-transport-http.png`、`model-transport-dark.png` | 合成数据的浅色/深色验收图 | 视觉检查，未使用真实 Key 或用户截图 |
| `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` | MCP SDK `1.30.1 → 1.31.0`；source-map-js `1.2.1 → 1.2.2`；http-cache-semantics `4.2.0 → 4.3.0` | 只替换三个版本；完整回归与独立离线安装通过 |
| `docs/opensource/dependency-licenses.json`、`dependency-security.json` | 更新实际依赖元数据，分别记录许可与安全公告，避免将元数据视为法律或漏洞豁免 | 669 个安装包版本的许可记录；剩余公告详见第 5 节 |
| `docs/opensource/ASSET_PROVENANCE.md`、`asset-inventory.json` | 226 项素材哈希与维护者再分发权利确认 | 维护者已明确确认“均为原创或已有可再分发授权” |
| `CONTRIBUTING.md`、`SECURITY.md`、`docs/PRIVACY.md` | 固定开发入口、贡献与安全报告方式、本地数据与联网边界 | 对照当前源码；没有虚构安全邮箱、SLA 或云能力 |
| `README.md`、`docs/UI_DESIGN_LANGUAGE.md` | 更新当前授权和报告入口，区分旧账号版 v0.2.3；清理失效的私有 UI 引用 | 两套现有 UI 语言保留；旧材料仍在历史/私有归档中 |
| `playwright.config.ts` | 移除已不存在的私有 console 测试排除项 | 没有删除有效测试或新增 skip |
| `scripts/macos-release/release.cjs` | 输出提示改称独立 Release 待发布文件 | 仅文字变更，没有执行发布流程 |
| `docs/opensource/PHASE3_READINESS.md` | 本报告 | 记录结果、残留风险和回滚路径 |

内部包问题的准确范围：原验证配置继承正式配置的 `snipviaAutoUpdate: true`，UI 因此错误显示可下载安装。原有 `ElectronUpdateInstaller` 在实际下载前仍会执行严格签名和 Team 检查，未发现可通过该标识绕过签名安装的路径。本轮修复能力声明，没有削弱正式更新保护。

## 4. 许可证、素材与隐私

Apache 2.0 已按维护者决定落地。它允许免费开源客户端及后续独立商业服务并存，并包含明确的专利许可与终止条款；不需要因此设计双版本代码。第三方许可和商标权继续独立适用。实施依据：[Apache 应用许可说明](https://www.apache.org/legal/apply-license.html)、[官方 FAQ](https://www.apache.org/foundation/license-faq.html)。

`pnpm build` 保留生产依赖原始 LICENSE / COPYING / NOTICE / COPYRIGHT / AUTHORS 文本和 Electron 的 LICENSE / Chromium 声明。`node-forge` 使用其 BSD-3-Clause 可选许可；不是把 GPL 分支强加给本项目，也不能由此忽略该包安全公告。清单覆盖整个已安装生产依赖图，可能多于最终实际执行的代码。元数据计数不等于人工审查了每个包的全部源文件和原生资源。

**尚未解决：** `lazy-val@1.0.5` 元数据声明 MIT，但安装包及本轮所核对的上游仓库未找到完整许可证文本，不能编造版权归属或从无关包复制 MIT 文本。正式 macOS hook 已阻止带缺失标记的清单通过。内部验收包仍可构建，不能将其作为对外发行许可已齐全的证据。验收标准：取得可追溯的原始通知并纳入生成产物，或经审阅替换依赖并完成回归，再确认 `missingLicenseFiles` 为空。

维护者已经确认 226 项图片/图标原创或有再分发授权，**不再要求重复确认这一点**。当前没有提供逐项外部来源链接，不据此虚构各文件作者和许可证。未来新增第三方素材应保留来源和必要通知；外部贡献、雇佣成果或已有第三方代码的授权仍须遵守原始权利范围。Apache 2.0 不授予项目商标使用权。

隐私边界已写入 `docs/PRIVACY.md`：截图/会话/笔记默认保留本机，保存的 Key 用系统 safeStorage；用户触发的模型和联网工具会发送任务所需内容，更新检查访问 GitHub。Renderer 在配置表单中处理用户新输入的 Key，已保存明文不通过查询 IPC 返回。远端 HTTP 提示不会重写旧配置或禁用本地免 Key 服务。

两张新增界面图已视觉检查。全部历史二进制图片没有逐张 OCR 或个人信息核验；权属确认与隐私画面核验是不同证据。公开前维护者可按素材清单检查历史演示画面，不应把模式扫描结果当成全面隐私保证。

## 5. 依赖安全检查与残留风险

本轮向 npm 注册表只读查询公告和精确版本，没有上传源码、Key 或用户数据。初次 `pnpm audit --json` 为 4 高危、1 中危；定向替换三个包后，全依赖检查为 **1 高危、1 中危**，生产依赖检查为 **1 高危**，两项 audit 退出码仍为 1，不能记录为通过。完整路径和复核条件见 [dependency-security.json](dependency-security.json)。

| 包与路径 | 本轮结论 | 后续验收 |
| --- | --- | --- |
| `@modelcontextprotocol/sdk`，Main MCP Client | 已锁定 `1.31.0`，不再命中公告；当前代码只用 `BoundedStdioTransport`，没有 OAuth HTTP 客户端 | 现有 MCP 协议、超时、工具目录和输入限制测试通过；后续若启用 OAuth 须另审 issuer 绑定 |
| `source-map-js`，Vite / PostCSS 工具链 | override 为已发布的 `1.2.2`，不再命中公告 | 类型、编译和全量测试通过 |
| `http-cache-semantics`，electron-builder 下载工具链 | override 为实际存在的 `4.3.0`，不再被注册表审计报告；未使用不存在的 `4.2.1` | 实际未签名本地打包通过；公告状态变化时复核 |
| `@anthropic-ai/sandbox-runtime > node-forge@1.4.0` | **仍为 high**；npm 未找到 `1.4.1`。当前 `ProcessSandbox.ts` 禁止网络且未配置 `tlsTerminate` / `mitmProxy`；安装的 sandbox-runtime 仅在显式 TLS 终止配置下创建 MITM CA，本轮未找到到受影响签名验证器的已启用调用路径 | 正式发行前采用已发布上游修复，或完成独立可达性复核和有记录的发行决定；不得写 audit ignore 将其伪装成已修复 |
| `electron-builder > … > roarr > sprintf-js@1.1.3` | **仍为 moderate**，属于开发/可选构建链；生产依赖图没有它，npm 未找到 `1.1.4` | 跟踪上游修复；构建使用可信源码和受控环境，不将未修复公告标成通过 |

上游依据：[MCP SDK 维护者公告](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)、[source-map-js 修复发布](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)、[http-cache-semantics 问题](https://github.com/kornelski/http-cache-semantics/issues/56)、[node-forge 待合入修复](https://github.com/digitalbazaar/forge/pull/1152)、[sprintf-js 问题](https://github.com/alexei/sprintf.js/issues/237)。这些来源用于核对公告，不构成对 Snipvia 可利用性的自动判断。本轮没有临时维护密码学 fork 或关闭 Agent 沙箱来消除依赖。

## 6. 验证结果与包体验收

环境：macOS arm64、Node.js `24.15.0`、pnpm `11.1.3`、Electron `44.4.1`。安装及版本查询使用 npm，原生构建使用本机 Xcode；模型请求使用合成数据和模拟服务。

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 60 个文件、945 项通过 |
| `pnpm build` | 通过，含 Main / Preload / Renderer 与依赖通知生成 |
| 最终完整 Electron 回归 | 同一次运行 42 通过、11 既有条件跳过、0 失败、0 flaky，194.2 秒；在三个安全依赖更新后执行 |
| `pnpm native:test` | Swift Helper arm64 / x86_64 通用构建与合成 OCR、framing、ping、错误命令和取消/退出协议测试通过；未触发真实录屏 |
| 独立源码副本 | `dist/phase3-clean-source` 未复制 `.git`；`pnpm install --offline --frozen-lockfile`、lint、typecheck、945 项单元测试和 build 均通过。不是从私有 workspace 或旧 node_modules 拷贝依赖；后续报告文字未影响这次代码验证 |
| 内部 arm64 应用目录 | 实际 electron-builder 未签名构建通过，`--publish never`，使用本地 Electron dist，不调用生产签名或公证 |
| ASAR 检查 | 6,277 个条目，无私有应用源码路径和实际环境/证书容器路径；根许可证、Electron 声明及 Main 产物哈希与本次构建一致；MCP SDK 为 1.31.0 |
| 内部包实际启动 | 真实 Main / Preload / Renderer 三窗口可用；临时用户目录、无账号桥接、无 Key 可启动、downloadSupported 为 false；使用既有 packaged-test 模式，跳过单实例锁/快捷键和启动更新任务，不等同普通生产启动或真实录屏验收 |
| 注册表漏洞检查 | 非通过：生产 1 high；全依赖 1 high / 1 moderate，详见第 5 节 |
| 模式和历史扫描 | 源码 488 份文本 / 236 份二进制分类、全部本地 Git blob 556 份文本 / 216 份二进制分类；8 处 URL 模式命中均核对为现有拒绝凭据 URL 的合成负例（含其历史副本），0 未决命中；私有应用树 / 实际凭据容器路径为 0。二进制未做语义或 OCR 审查 |

11 项既有条件跳过为 9 项真实录屏/ScreenCaptureKit 实验、1 项已打包 Helper 录屏和 1 项已安装 Windows 验收。新 HTTP 用例没有增加 skip。测试产生的旧 UI 截图另存忽略目录后恢复原件，仅保留本轮新增两图。

最终内部应用目录：`dist/macos-validation/1792141273351-59220d74/mac-arm64/Snipvia.app`。Bundle ID 仍为 `com.snipvia.desktop`，版本仍为 `0.2.3`；这只是内部验证，**不得复用此版本号对外发布免费版**。Helper 为 x86_64 / arm64 通用文件，应用本体本轮只打包并运行 arm64。内部包禁用安装更新，正式配置仍启用签名、公证与显式安装更新。

本地日志、审计原始 JSON、完整 Playwright 结果、包体哈希和启动记录在被忽略的 `.dev-runtime/phase3/`。初次 actool 因未选择完整 Xcode 失败，指定 `/Applications/Xcode.app/Contents/Developer` 后成功；另一次检查发现内部更新标识问题并已修复、重打包，没有把失败尝试算作通过。

## 7. Git、配置与更新渠道复核

本地独立客户端的根为 `1e058214961fbd0225f6145f359f931995e6543d`，没有继承旧混合仓库。检查当前源文件、全部本地 Git blob 及所有可达提交树；没有发现私有应用树或原私有 HEAD 对象，也没有把忽略目录、备份或依赖目录当作公开输入。凭据模式覆盖私钥、常见 Token、AWS 标识和带凭据 URL；不验证凭据有效性，不输出疑似秘密原文。最终扫描为 0 未决命中；8 处 URL 模式命中已逐项核对为三份现有测试的合成负例及相同历史 blob，保留命中哈希和核对理由，不通过整类排除 tests 掩盖命中。结果见 `.dev-runtime/phase3/security-final-scan.json`。

2026-10-16 的只读远程检查：新 `yuyeyuyy/Snipvia` 为 Private、默认分支 main、未归档；匿名 `/repos/yuyeyuyy/Snipvia/releases/latest` 返回 404。旧 `Snipvia-releases` 匿名查询仍返回 v0.2.3 及其 6 个资产。没有修改这些远程状态。

源码更新目标已是 `src/shared/release-source.json` 中的 `yuyeyuyy/Snipvia`，Main 与发行脚本共用它；官网关闭不影响这个 URL 设计。但新渠道当前尚不能向匿名客户端提供正式更新，不能宣称线上更新已验收。旧已安装账号版仍使用旧渠道，切换新源码配置不会追溯修改已安装二进制。

现有 CI 只有 `.github/workflows/windows-internal.yml` 的手动内部 Windows 工作流，默认不上传资产，不是已经运行成功的正式跨平台发布管线。本轮没有触发远程 Actions。后续可增加 macOS / Windows PR 检查并将 Actions 固定到核实过的提交 SHA；当前 `@v4` 标签和未实跑的平台证据列为持续改进项。

## 8. 剩余门槛与下一阶段输入

| 优先级 / 门槛 | 证据及风险 | 下一阶段验收标准 |
| --- | --- | --- |
| 正式发行前必须：依赖通知完整 | `out/licenses/dependencies.json` 标记 lazy-val 缺失；目前正式 hook 会拒绝 | 获得可追溯许可文本或审阅替代依赖；生成清单无缺项，包内保留通知 |
| 正式发行前必须：生产 high 公告处理 | `dependency-security.json` 与 `ProcessSandbox.ts`；没有已发布 node-forge 修复版 | 上游正式修复并回归，或独立复核当前不可达边界后由维护者记录发行决定；不静默豁免 |
| 正式发行前必须：版本和更新渠道 | 仍为内部 v0.2.3，新仓库匿名 404 | 确定大于旧版的新版本及资产名、更新元数据/哈希；另行授权后验证匿名下载，制定旧渠道过渡方案 |
| 正式发行前必须：签名、旧版升级与数据回退 | 本轮没有使用 Developer ID、公证或真实旧数据 | 同一系统用户完整备份 userData；同 Bundle ID / 正确签名身份下验证旧 v0.2.3 → 新版，逐项检查截图、聊天、笔记、分支、模型、Key、快捷键和主题；验证回退 |
| 宣称平台支持前必须：真机 | 本轮只有 arm64 合成测试和内部包；Windows 命令沙箱仍未开放 | Intel、Windows DPAPI / 安装卸载、混合 DPI、录屏权限、Helper 故障恢复和更新后重启的设备记录 |
| P1：实际模型供应商 | 当前为协议 fixture，没有真实厂商 Key | 指定支持图片和 Tool Calling 的用户模型，用合成数据作授权联网验收；不把所有预设模型视为已验证 |
| P1：历史素材隐私与第三方通知维护 | 权属已确认，但未对全部旧图逐张 OCR；原始第三方要求仍适用 | 按清单复核待公开画面，新增内容保留来源，不要求重复整体权属确认 |
| P2：开发工具 moderate 与 CI | sprintf-js 尚无修复版；CI 仅手动 Windows | 跟踪上游，构建环境受控，逐步加入自动跨平台检查与 Actions SHA 固定 |

不需要云同步、订阅、账号系统、商业版分层或重新拆 workspace 才能进入后续阶段。生产后台仍可能服务旧账号版，不能因新源码无需账号而自动停服。

## 9. 回滚与交接

本轮没有迁移真实用户数据，也没有改 appId、Bundle ID、正式 userData 目录或保存格式。原旧凭据容器迁移仍遵循现有“成功保存再清理、失败留原件”逻辑；这不等于完成了真实签名旧版本升级。

回滚材料位于本工作区 `.dev-runtime/phase3/`，包含开始前 Git bundle、patch、原有三文件、哈希清单和 UI 原件。恢复应在一个**不存在的新目录**中进行：从 `before.bundle` 克隆开始前分支 `codex/phase2-acceptance`，检查 patch 后应用，再按 `manifest-before.json` 复制保全的 Phase 2 原件。不要在当前唯一工作区执行 reset / clean 或覆盖恢复；bundle 不包含未跟踪原件，因此不能省略这一步。

若需要保留本轮结果再回退，先将当前文件清单及差异导出到另一个本地检查点。原 Phase 1/历史隔离检查点继续有效；本轮没有使用其恢复脚本或改动私有归档。安装包、日志、依赖与备份均留在忽略目录，不能整目录上传。

本轮停止在可审阅的本地代码、测试、许可证和报告。后续阶段需维护者确认验收结果、发行门槛的处理方案及明确操作范围；本报告不授权远程推送、公开、正式 Release、签名公证或停服。
