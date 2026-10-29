# Snipvia v1.0.0 代码与发布审查

审查日期：2026-10-29。开发工作区为 `Snipvia-public-baseline`，分支 `refactor/snipvia-v2`，起始 HEAD 为 `2c93e3adfe90b8880e103528cef0aa4a29cf0de0`。本轮检查包含既有未提交、未跟踪的新功能，未修改 legacy 或 server 仓库。

## 结论

**可以提交当前开发基线；正式 v1.0.0 发布为 No-Go。** 业务回归已通过，但 Electron 运行时及构建依赖仍有安全公告，且本机缺少正式 macOS 打包需要的完整 Xcode。版本号已准备为 1.0.0，不代表已经发行。

审查阶段没有执行 Git add、commit、push、打标签、签名、公证或 Release 上传。审查完成后，维护者已明确授权将本阶段文件提交到本地 Git；远程推送仍由维护者安排。本次提交包含源码、测试、构建输入及文档，排除密钥、用户数据、开发快照与生成产物。没有用旧安装包作为本次产物，也没有修改系统权限、开发 App 签名、应用 ID 或用户数据目录。

## “不能发布”的具体含义

当前 `pnpm build` 与合成 Electron 回归可通过，开发版可以运行。发布结论区分以下条件，不将审计建议描述成 GitHub 或 Apple 已拒绝发布：

1. **实际阻挡正式构建的环境条件**：再次执行只读 preflight 仍报“需要完整 Xcode。”；`xcode-select -p` 为 `/Library/Developer/CommandLineTools`，`xcrun --find xcodebuild` 失败。当前正式脚本在构建前即退出，尚未进入签名/公证，更没有公证失败证据。完整 Xcode 还用于现有 `.icon` 图标编译与原生正式构建；不能仅删掉预检断言后宣称流程可用。
2. **正式发行的安全放行条件**：Electron 44.4.1 的公告影响随安装包分发的运行时，另有开发/构建依赖公告。现有 release 脚本不会因这些公告自动向 GitHub 报错，本报告建议先修复后发行；单测成功或只审计 production 依赖不能替代该检查。
3. **源码与产物一致性条件**：本次本地 commit 可解除未提交源码这一项阻挡。发布前仍需将该确切提交推送到配置仓库，让发布脚本核对远程 sourceCommit 与标签；本地 Git 提交不等于远程已更新。
4. **平台放行范围**：Windows 安装/卸载、真实多文件粘贴与混合 DPI 尚未验证，属于 Windows 正式包的保留项；不要求为了单独发行 macOS 而先证明所有 Windows 行为。升级 Electron 后的原生权限、截图及正式签名包验收则与 macOS 包自身有关。

建议顺序：先保存本地功能基线，再单独升级存在公告的依赖，保全并验证固定开发 App 的运行时/权限迁移；配置完整 Xcode；复用未变更步骤的既有验收，仅重验受运行时和安装包改变影响的项目；完成源码推送、签名、公证与最终产物校验后发行。无需为此引入账号服务、改变 App ID 或重写截图架构。

## 审查范围和架构判断

检查 Main 截图入口、原生 Helper、输出队列、编辑/钉图、收纳与剪贴板、快速切换/Chrome worker、图标网络读取、Preload/IPC、设置和旧数据兼容、依赖锁文件、构建签名发布脚本及测试。未逐条证明每个函数在全部设备上的行为，也未重新扫描完整 Git 历史。

- 当前实际产品为轻量截图工具；没有初始化账号、会员、AI Provider 或 Agent。旧版文件由 `src/main/legacy/LegacyDataService.ts` 只读兼容，不能按旧项目说明宣称仍有 AI 对话或笔记编辑。
- `src/main/index.ts` 保留 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；IPC 按窗口角色和主 frame 校验，再解析参数。窗口禁止外部导航和新窗口。快速切换不接收截图字节，不自动粘贴或发送。
- `src/main/quick-target/WebsiteIconFetch.ts` 对图标地址、DNS/重定向、响应大小和超时设限；只读取用户配置网页的公开 origin。`WebsiteIconCache.ts` 保留有界缓存与并发。网页/CDN 会收到图标请求，实际边界见[隐私说明](../PRIVACY.md)，不能将“本地优先”解释成永不联网。
- 收纳仅在当前进程内保留；全部复制的独立文件有本地暂存周期。重启不恢复图堆，不能作为持久备份。原生拖放与多文件粘贴还取决于接收应用。
- GitHub 更新与账号无关。`src/main/updates/ElectronUpdateInstaller.ts` 只允许正式配置的 macOS 签名包自动安装，校验当前签名及精确 Release 元数据。Windows 保留检查与手动安装，不能宣称已具备签名自动安装更新。

## 已修复的问题

| 优先级 | 文件与证据 | 风险与修复 | 验收结果 |
| --- | --- | --- | --- |
| P1 | `src/main/index.ts` 编辑保存路径；`src/main/windows/capture-overlay-window.ts` 的 `ordered` / `suspended` 状态 | 原先直接隐藏原生窗口，取消保存后管理器仍认为已显示，截图层无法恢复。新增按 session 的 `pauseForDialog` / `resumeAfterDialog`，复用既有暂停和 ACK 状态；过期对话框不能唤醒后续会话。 | 新增两项单测；完整编辑、取消保存、复制、保存和钉图集成测试通过。 |
| P1 | `package.json`、`pnpm-lock.yaml` 原为 `zod@4.6.5` | 命中集合校验内存耗尽公告。精确升级到 `4.6.6`，没有批量更新其他包。 | 类型检查、单测、构建和集成回归通过；生产依赖审计为零。公告：[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。 |
| P1 | `scripts/macos-release/publish.cjs` 原固定 `--target main`，当前代码在 V2 分支 | Release 标签可能与安装包源码不一致。`common.cjs` 要求干净已提交源码；`release.cjs` 记录并复核完整 `sourceCommit`；发布前核对远程提交、普通/注释标签及草稿，标签精确指向该提交。冲突、鉴权或网络异常均拒绝发布。 | 新增五项发布来源测试通过；没有执行远程写入。旧报告缺少来源提交时拒绝复用。 |
| P2 | `tests/integration/capture-entry-headless.spec.ts` 在编译文件末尾注入顶层 `const png`，与新图标解析器的 `function png` 重名 | 测试程序解析失败，表现为启动超时。将注入包在独立作用域；等待精确会话及渲染就绪，保留两次连续框选及延迟帧断言。 | 单独运行和完整回归均通过；没有删除断言或跳过测试。 |
| P2 | `capture-window-visibility.spec.ts` 的钉图零按钮断言、设置测试的旧入口及截图路径 | 与现有已批准的钉图控件/菜单设置不符，且会覆盖文档截图。改为验证两个准确标签、按当前导航操作，将设置测试输出放到 `test-results/`。 | 两种捕获后端、设置及编辑回归通过；恢复被首轮测试覆盖的原文档截图。 |

## 未解决的发布阻断与边界

### P0：升级 Electron 后才可发布正式安装包

`package.json` 仍固定 `electron@44.4.1`，`pnpm-lock.yaml` 对应相同版本。虽然它属于 devDependencies，Electron 二进制实际进入安装包，**不能因 `pnpm audit --prod` 为零而忽略**。

完整依赖审计检出 Electron 的 4 条公告，包括高危的 [GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9)：被泄露的中间证书可能用于网络拦截，44.x 修复线为 **44.9.1**，官方说明不存在应用层替代修复。本项目具有更新和网站图标网络连接，不能以完全离线应用排除风险。其余公告涉及 frame geometry 和 pointer lock；没有据此假定当前业务已经被利用。

修复建议：在单独的安全升级提交中精确选择已修补的 44.x 稳定版，更新锁文件，重新检查全部公告并跑构建、单测、Electron 回归、原生截图及安装包验收。开发启动器 `scripts/dev-stable-app.sh` 明确拒绝运行时版本不一致，以保护固定开发 App 的权限主体。本轮没有直接替换已授权的 `截然 Dev.app`；后续升级必须保全旧 App，并按实际签名确认录屏、自动化、辅助功能状态，不能静默重置权限。

验收：新锁文件不再命中这些 Electron 公告；实际打包运行时版本一致；两种架构 Helper、录屏、连续截图、Chrome 切换及更新签名均通过对应验收。仅改变 package.json 而复用旧二进制不算修复。

### P1：开发与打包依赖尚有公告

完整依赖树审计合计 **28 条记录：9 high / 14 moderate / 5 low / 0 critical**；其中包含同一公告在不同依赖大版本的记录，不代表 28 个已确认的业务漏洞。可提交的脱敏结果见 [依赖审计明细](V1_0_0_DEPENDENCY_AUDIT.json)。

| 依赖位置 | 当前版本 | 公告给出的修补线 | 影响与验收 |
| --- | --- | --- | --- |
| `package.json` 的 Vite | 7.3.6 | 7.3.7 | 开发服务及 Windows editor 路径相关风险；见 [高危公告](https://github.com/advisories/GHSA-587h-7wmj-h5pm)。更新后验证开发服务、打包及锁文件，不把开发服务暴露给不可信网络。 |
| Vitest → `@vitest/mocker` | 4.1.11 | 4.1.12 | mock 注册注入和路径穿越；见 [官方公告](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)。精确升级相应 Vitest 补丁并重新跑单测。当前使用 `vitest run`，没有证明存在可被外部调用的 mock 服务。 |
| Electron 下载器 → undici | 7.29.1 | 7.30.1 | 下载工具链相关 TLS、缓存及资源耗尽公告；升级上游并复核锁文件。 |
| electron-builder → rebuild → node-gyp → undici | 6.28.1 | 6.29.1 | 构建工具链；不能直接推断成客户端运行时 fetch 使用该包。优先上游兼容补丁，必要 override 必须有独立验证。 |
| electron-builder → app-builder-lib → ajv → fast-uri | 3.1.8 | 3.1.9 | URL 解析与校验相关公告；更新上游/兼容补丁后跑配置、签名发布计划和 Windows 构建验证。 |

本轮仅修复了业务依赖 Zod，没有将整个运行时与构建工具链升级混入功能收尾。以上结果不满足正式版本安全放行条件。

### P1：本机正式 macOS 发布环境不完整

`node scripts/macos-release/preflight.cjs` 返回 **“需要完整 Xcode。”**；当前 `xcode-select -p` 指向 CommandLineTools，正式脚本默认需要 `/Applications/Xcode.app/Contents/Developer`。没有通过临时签名或关闭验证绕过。

修复与验收：安装/配置受支持完整 Xcode，重新执行 preflight；从已提交源码重建两种架构，完成 Developer ID 签名、公证 Accepted、Staple、Gatekeeper、ZIP/DMG 最终哈希与元数据验收。钥匙串公证凭据的远程有效性本轮未验证，不能仅因配置了 Profile 就宣称可用。

### P1：平台验收仍须区分

Windows 只运行了可在当前 macOS 上执行的 Renderer/适配逻辑测试，没有验收真实 Windows 安装、卸载、剪贴板多文件、原生拖放、混合 DPI。macOS Intel 及正式签名包权限/更新路径也没有通过本轮源码测试获得真机证明。若与 macOS 一同正式发布 Windows，需要补齐这些验证；不能复用旧 V1 的包或结论。

### P2：持续集成只覆盖手动 Windows 内部验收

`.github/workflows/windows-internal.yml` 当前仅有 `workflow_dispatch`，权限为只读、默认不上传内部包；没有自动触发的 PR/macOS 回归。Actions 使用 `@v4` 主版本标签，尚未固定完整提交 SHA；`package.json` 的 `@types/node` 仍为范围版本，实际安装由冻结锁文件约束。这些不改变本轮本机测试结果，但提交后不能假定 GitHub 会自动完成全平台验证。

建议：后续增加不含发布凭据的 PR 静态检查/单测和 macOS 合成回归；发布工作流保持独立权限边界。固定已核实的 Actions 提交和依赖版本，验收以真正运行的 CI 记录为准。本轮没有触发远程工作流。

## 最终验证结果

工具版本：Node 24.15.0、pnpm 11.1.3；本轮测试使用 Electron 44.4.1。结果适用于当前候选代码和现有运行时，不涵盖后续依赖升级。

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过；最终 `pnpm test:smoke` 的 build 再次执行 |
| `pnpm test` | 51 个文件、288 项通过 |
| `pnpm build` | 通过；生产包许可证清单 122 个版本，未检出缺少许可证文件的版本 |
| `pnpm test:smoke` | 最终 31 通过、12 按原条件未执行，0 失败；约 2.1 分钟 |
| 原生浏览器开发 Helper | worker ready、三次非法请求拒绝及脚本编译通过；现有二进制包含 arm64 / x86_64。没有读取用户标签或激活目标 |
| `pnpm audit --prod --json` | 122 个生产依赖版本；各级别公告为 0。此命令不覆盖 Electron 运行时 |
| `pnpm audit --json` | 非零退出；28 条公告，详见上文，尚未放行 |
| 当前源码敏感项扫描 | Git 已跟踪及非忽略未跟踪、可解码且不超过 3 MiB 的文本；零疑似私钥/常见 Token/云访问 Key，零生产数据库/证书文件候选。仅为规则扫描，不代表全历史或所有秘密类型安全证明 |
| 正式 macOS preflight | 未通过，缺完整 Xcode；未执行签名或公证 |

首轮完整回归为 27 通过、4 失败、12 未执行；其中保存取消是真实产品缺陷，另外三个失败是两种后端的钉图旧断言及注入变量冲突。修复后重新跑完整测试得到上述最终结果，没有为通过测试新增 skip 或删除有效测试。12 项原条件测试需要真实屏幕、长时负载或正式包，未启用相关环境变量。

原始本机记录位于被 Git 忽略的 `.dev-runtime/v1-review/`：`final-smoke.log`、`dependency-audit*.json`、`source-scan.json`。这些诊断和恢复文件不应提交到公开仓库。

## 文件级本轮增量

- `src/main/index.ts`、`src/main/windows/capture-overlay-window.ts`：保存对话框暂停与恢复。
- `package.json`、`pnpm-lock.yaml`：1.0.0 候选及 Zod 4.6.6。
- `scripts/macos-release/{common,release,publish}.cjs`：干净源码、来源提交和远程标签一致性。
- `tests/unit/capture-overlay-window.test.ts`、`release-publication.test.ts`、新增 `release-source.test.ts`：窗口及发行来源回归。
- `tests/integration/{capture-entry-headless,capture-window-visibility,screenshot-editor,v2-settings}.spec.ts`：维护有效断言及隔离输出。
- `README.md`、`docs/MACOS_RELEASE.md`、`docs/RELEASE_DISTRIBUTION.md`、新增 `docs/RELEASE_NOTES_v1.0.0.md`、本报告与依赖明细：同步真实产品和发行状态。

此前已经存在的快速切换、网站图标、设置菜单、收纳改进、Swift Helper、entitlements 及对应测试均保留，不能只提交本轮少数修复而遗漏未跟踪文件。新增原生 Helper 及资源属于构建输入。测试输出目录和开发快照不属于提交内容。

## 提交、回滚与下一步

建议当前先提交一个可恢复的功能基线，之后单独提交运行时/构建依赖安全升级；两者均可推送开发分支，但在发布阻断清除前不要创建正式 v1.0.0 标签。

```text
feat: add quick target switching and prepare Snipvia 1.0.0 candidate

- add configurable app and Chrome tab targets with website icons
- refine collection copy flows and grouped settings navigation
- restore the capture editor after cancelling Save
- patch Zod and bind release tags to verified source commits
- expand regression tests and record remaining release blockers
```

审查前完整本机快照：`.dev-runtime/v1-review/before-20261029-092949/`，含 370 个已跟踪/未跟踪文件的源码副本、SHA-256 manifest、起始工作区状态及 binary patch。恢复时先保留后续改动，再逐项从 `source/` 恢复，不执行 `reset --hard` 或 `clean`；未删除既有文件。该快照不包含系统权限、用户数据或正式密钥，不能用于回滚这些外部状态。

发布顺序：提交当前基线 → 修复依赖公告并验证运行时迁移 → 配置完整 Xcode → 提交安全升级并由维护者推送 → 从干净提交执行正式签名、公证及平台验收 → 校验报告与远程源码一致 → 发布 v1.0.0。验收缓存只能复用输入和产物指纹均未变的步骤；运行时升级和签名包验证不可用旧结果替代。
