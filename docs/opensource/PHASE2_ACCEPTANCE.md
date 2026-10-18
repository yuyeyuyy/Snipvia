# Snipvia Phase 2：免费、无账号、本地优先验收

日期：2026-10-16。结论：**本阶段代码验收通过；无需重复修改已完成的业务实现。正式安装包升级和跨平台真机验收仍待 Phase 3。** 本报告的 Phase 2 按本轮指令进行功能验收，没有自动追加早期方案中可选的 Jev / TypeSafe 适配。

## 1. 工作区、基线与操作范围

- 唯一开发目录：`/Users/macbook/IdeaProjects/Snipvia-public-baseline`。
- 起始分支 `main`，HEAD `ce46e1fff25ac7abae4f0e85f76393990042ceb8`，起始工作区干净；`origin` 为 `https://github.com/yuyeyuyy/Snipvia.git`。
- 本轮本地分支：`codex/phase2-acceptance`。已阅读[历史隔离报告](REPOSITORY_ISOLATION_REPORT.md)，使用新客户端自身的源码、独立依赖和测试作判断。
- 没有修改 `Snipvia-legacy`、`Snipvia-server` 或原 `Snipvia/` 恢复目录；没有执行远程查询、拉取、推送、公开、正式 Release、签名、公证、安装更新或生产停服。
- 操作前的 Git bundle、环境信息和测试图片快照保存在本工作区被忽略的 `.dev-runtime/phase2/`。没有读取真实用户的截图、笔记、账号 Cookie 或模型 Key。

## 2. 已实现并验证的功能

以下均以当前源码和本轮执行结果为准；这些业务文件没有为了本次验收再次修改。

| 检查项 | 实际证据 | 验收结果 |
| --- | --- | --- |
| Main 不初始化旧账号服务 | `src/main/index.ts` 的导入、启动和 IPC 注册中没有 AccountService 或账号处理器；剩余 `legacyAccountDirectory` 只进入 Agent 受保护目录列表 | 已实现并验证；现有 local-first 集成测试同时检查旧账号 IPC 未注册 |
| Renderer、Preload 无登录/会员入口 | `src/renderer/src/App.tsx`、`components/AppShell.tsx`、`components/AppTitleBar.tsx`、`src/preload/index.ts`、`src/shared/contracts.ts` 不再暴露账号功能 | 已实现并验证；无账号按钮或 account bridge，不以登录成功为启动条件 |
| 本地截图、标注、历史、笔记免费使用 | Main 的 capture、history、notes IPC 直接进入本地服务，不查询资格；无 Key 的新增回归实际编辑旧笔记、读取历史、截图标注并置顶转对话 | 已实现并验证；完整截图编辑与笔记回归也通过 |
| 截图 AI 不依赖账号状态 | `beginAutoUnderstanding` 从 `publicSettings()` 取配置快照，由 Main `readKey` 取得对应厂商凭据；不读取旧 Cookie | 已实现并验证；无 Key 提示模型配置，旧损坏 Cookie 不影响截图 |
| AI 笔记与 Agent 不受会员限制 | Main 的 NotebookWriter 和 EditingProposals 写入前只进行编辑器 flush、授权、冲突和确认检查 | 已实现并验证；Agent 笔记确认、实际保存、撤销和取消的既有集成测试完整通过 |
| 预测直接使用用户模型 | `PredictionService.ts` → `classifyScreenshot` → 用户 endpoint 的 `/chat/completions` | 已实现并验证；带用户 Key 的本地模型收到真实 Main 请求，不调用官方预测代理 |
| 配置和凭据独立可用 | `storage/settings.ts` 使用 endpoint 作用域和 Electron safeStorage；PublicSettings 只返回 hasApiKey 等状态 | 已实现并验证；系统加密的合成 Key 跨重启可用，设置文件及返回值不含明文 Key |
| 官方服务不可用仍可启动 | 新增 fixture 在导入 Main 前封锁非测试网络，保留旧账号环境变量并放入不可解密的旧会话 | 已实现并验证；启动、本地数据、模型和模拟 GitHub 检查完成，没有尝试被封锁的服务 |
| 更新能力独立保留 | `src/shared/release-source.json` 为 `yuyeyuyy/Snipvia`；UpdateCheckService 与 ElectronUpdateInstaller 不引用账号 | 已实现并验证；匿名更新请求不带 Key/Cookie，既有下载状态、确认安装及保存笔记流程通过模拟验收 |
| 黑白灰主题和原交互结构保留 | Renderer、样式和主题业务未修改 | 已实现并验证；完整 smoke 包括主题同步、重启恢复、Monochrome、主窗口和悬浮工作区 |

“登录 Windows/Mac 后自启”是操作系统登录项，模型厂商的账户目录也不是 Snipvia 官方账号依赖，没有按关键词误删。`ScreenshotAnalyzerResult` 中保留的历史 layer 枚举不代表存在 TypeSafe 请求。

## 3. 预测与模型配置调用链

当前调用链如下：

```text
框选完成 → 用户空输入按 Enter / auto-action:start
→ Main beginAutoUnderstanding
→ 复制当前模型、启用分支及适用条件；Main 读取对应作用域 Key
→ ScreenshotAnalyzer（本机 OCR 作为辅助文本）
→ PredictionService.predict → requireModelConfiguration
→ classifyScreenshot → requestPredictionJson
→ 用户模型 /chat/completions
→ 严格解析 contentType / confidence / matchedBranchId / signals
→ autoActionRouter → 相应 Agent 操作或待确认日程草稿
```

关键证据：`src/main/index.ts:827`、`src/main/analysis/PredictionService.ts:9`、`src/main/analysis/screenshot-analyzer.ts`、`src/main/ai/provider.ts:171`、`src/main/ai/model-configuration.ts:4`、`src/main/ai/json-request.ts`、`src/main/analysis/auto-action-router.ts`。

- 托管预设没有 Key 时，普通问答、Agent 和预测均在请求前提示配置；`custom` 允许无认证的本地模型。**无 Key 不等于禁用本地功能，也不等于禁止用户主动配置免 Key 服务。**
- 预测只发送选中裁剪图和启用分支的适用条件，不发送 Cookie、笔记本 ID 或分支执行 prompt。新增回归检查实际请求的模型 ID、Bearer Key、无 Cookie、裁剪图及以上字段边界。
- 预测命中后，执行分支的 Agent 请求才包含执行 prompt；其工具授权和写入确认继续生效。新增回归同时验证预测请求与后续执行请求不同的输入边界。
- 未命中、低置信度、未知/停用 ID、坏 JSON、超时和取消不会借 OCR 结果自动执行分支；既有 `prediction-service.test.ts`、`screenshot-analyzer.test.ts`、`prediction-criteria.spec.ts`、`prediction-errors.spec.ts` 验证这些边界。
- Main 保存配置会取消进行中的预测。响应上限 128 KiB，超时 45 秒，禁止重定向，忽略 Cookie，安全错误不转发上游正文。
- 没有 Jev Key 时不需要代理或备用账号；当前代码始终以用户模型预测。没有实现可选 Jev 配置和直连，本轮不把未实现项写成既有能力。

## 4. 老版本数据与应用身份

本轮使用合成的 v0.2.3 既有磁盘结构，在 Main 加载存储模块之前直接写入输入，不通过当前存储 writer 生成兼容性样本。`package.json` 仍为 `0.2.3`；settings/history/notebook 存储和发布身份配置相对独立根快照没有业务改动。本轮没有引入迁移或重写已有格式。

| 数据 | 验证内容 | 结果与边界 |
| --- | --- | --- |
| 截图历史 | `history/conversations.json` 与 `history/captures/<id>.jpg`；旧截图可读，新截图不会覆盖旧条目 | 已实现并验证，合成 JPEG |
| 对话记录 | 旧 user/assistant 消息和模型 profile，重启后读取，执行新请求后旧条目保持不变 | 已实现并验证 |
| 本地笔记 | `notebooks.json` 的旧授权目录、activeId、原 Markdown 内容；无 Key 时实际保存修改 | 已实现并验证；目录按原授权服务要求使用规范路径 |
| 预测分支 | 旧自定义 ID、名称、适用条件、执行 prompt 和 notebookId 绑定 | 已实现并验证；重启后可直接匹配并执行，配置文件字节不变 |
| 自定义模型 | provider、endpoint、model 以及 profile | 已实现并验证；旧配置直接用于 Main 预测与对话；其他厂商/接口切换沿用已有回归 |
| 已保存 API Key | 在临时实例中用真实 Electron safeStorage 加密合成 Key，关闭并重新启动后发出正确鉴权请求 | 已实现并验证，未 mock safeStorage；不等同于已验证正式签名应用跨版本的 Keychain/DPAPI 访问 |
| 快捷键 | 保留三项自定义快捷键并检查 Electron globalShortcut 实际注册 | 已实现并验证 |
| 主题 | 旧 dark 设置跨重启恢复；已有回归覆盖 Light / Dark / System 与跨窗口同步 | 已实现并验证 |
| 旧账号数据 | `account/session.json` 含损坏的旧密文；不解密、不覆盖、不删除 | 已实现并验证；旧目录仍受 Agent 文件保护 |

没有改动 `app.getPath('userData')` 的解析方式。仅既有开发热更新模式使用 `snipvia-dev`；正式应用继续使用原路径。`electron-builder.yml` 的 `appId: com.snipvia.desktop`、`productName: Snipvia`、Mac Bundle ID 及 Windows AppUserModelId 均保持原实现。测试通过显式临时 `--user-data-dir` 隔离，不访问或覆盖安装版真实数据。

更早版本的 `credentials.json` / `credentials.key` 迁移逻辑原本已存在：成功保存 safeStorage 密文后清理旧容器，迁移失败保留原件；`settings.test.ts` 覆盖这些分支。本轮未改动或在真实数据上触发此逻辑。若实际升级涉及这种旧格式，Phase 3 必须先备份整个用户数据目录，再验证迁移与回退，不能只复制单个密文文件。

## 5. 安全边界复核

- `src/main/index.ts:143` 继续统一设置 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；`loadWindow` 拒绝新窗口和导航。新增回归检查 Main、Overlay、Pin 的实际进程沙箱指标、冻结的 contextBridge API 以及 Renderer 没有 require。
- `handle` 和 Agent IPC 保留窗口/主 frame 身份检查与 Zod 参数校验。新增回归通过真实 Renderer IPC 尝试 `../settings.json` 被拒绝；既有跨窗口与 Agent 授权测试继续通过。
- Key 只由 Main 读取，Renderer 获取的是配置状态；用户输入新 Key 时仍通过原设置表单提交。新增回归检查返回设置、渲染内容、磁盘设置和采集到的 Main 日志不出现测试 Key。没有新增 readKey IPC 或日志。
- Agent 的工作区能力、受保护目录、单次写入确认、diff、冲突检测和撤销继续保留；移除账号没有放宽这些权限。Windows 命令沙箱原本尚未开放，本轮没有开放。
- 用户主动使用联网工具时，Agent 仍可访问 Exa / Brave / DuckDuckGo 和目标网页，见 `src/main/agent/web/`；不能把“本地优先”描述成全部离线或所有网络只有模型域名。普通模型调用与预测不依赖 Snipvia 官方账号服务。

## 6. 本轮实际修改与旧依赖

| 文件 | 实际修改 | 原因 |
| --- | --- | --- |
| `tests/integration/local-first-compatibility.spec.ts` | 新增 2 项 Electron 验收及其临时 fixture | 补齐启动前网络隔离、无 Key 本地编辑、旧格式加载、系统加密 Key 跨重启、直接预测/Agent、匿名更新和 IPC 边界 |
| `tests/unit/editing-proposals.test.ts:104` | 将“资格失败/无会员资格”改为“编辑器刷新失败” | beforeWrite 实际负责 flush，不再负责会员检查；保留失败不写入、并发防重及附属记录失败的全部断言 |
| `docs/opensource/PHASE2_ACCEPTANCE.md` | 本报告 | 记录真实验收、风险和下一阶段输入 |

**业务代码、UI、原生代码、依赖、锁文件、发布配置均未修改。本轮没有新删除的旧依赖。** 旧 AccountService、资格 bridge、账号 IPC 和后台 workspace 已在 Phase 1 前后退出新客户端；本轮只是确认当前 `pnpm-workspace.yaml` 只有根项目、运行源码没有旧账号环境变量/端点/资格服务。没有为了增加修改量重新移除它们。

## 7. 测试结果与复现

环境：macOS arm64，Node.js `24.15.0`，pnpm `11.1.3`。未使用生产账号、真实用户模型 Key 或收费模型请求。

| 命令/检查 | 最终结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 58 个文件、929 项通过 |
| `pnpm build` | 通过，含严格类型检查和 Main / Preload / Renderer 构建 |
| 新增兼容性用例单独运行 | 2 项通过 |
| `pnpm test:smoke --reporter=list,json` | **同一次完整运行 41 通过、11 条件跳过、0 失败、0 flaky，约 3 分钟**；包含新增两项和全部既有用例 |
| 更新专项 | `updates.spec.ts` 全流程通过；单元测试覆盖固定发布地址、版本/哈希元数据、签名失败拒绝下载和显式安装要求；没有实际安装 |
| 文件差异检查 | 无业务源文件或应用身份变更；测试生成的 UI 图片另存验收产物，恢复原文档图片 |

11 项跳过均为原有环境条件：9 项真实录屏/ScreenCaptureKit 性能、故障和显示器实验，1 项已打包 Mac Helper 验收，1 项已安装 Windows 安装包验收。本轮没有新增 skip、删除有效用例或将跳过记作通过。`windows-capture-ui.spec.ts` 的通过是模拟 Windows 渲染交互，不能代替 Windows 真机。

新增测试开发中修正过 fixture 的临时目录规范路径和 Electron 检查 API；这不是产品缺陷，也没有修改产品授权逻辑来让测试通过。最后一次完整 smoke 已全部完成，不以分次局部绿代替最终全量结果。

详细命令日志、Playwright JSON、初始 bundle 和合成 UI 产物留在被忽略的 `.dev-runtime/phase2/`。失败 trace 等 Playwright 临时产物在 `test-results/`，不提交。复现时在本工作区使用上述 Node/pnpm 版本执行表中命令；无须后台或私有 workspace。

## 8. 仍然存在的问题与兼容性风险

| 项目与证据 | 当前边界 | 后续验收标准 |
| --- | --- | --- |
| 正式旧版数据升级：本轮只使用临时合成结构和当前系统凭据保护 | 未读取真实 v0.2.3 用户目录，也未运行旧签名包 → 新签名包升级；不能保证不同签名/OS 用户/机器的密文能直接解密 | Phase 3 在备份和可回退条件下，使用同一用户真实签名应用验证截图、聊天、笔记、分支、Key、快捷键和主题 |
| 跨平台和录屏：11 个既有环境条件未满足 | Intel Mac、Windows 安装/DPAPI、混合 DPI、真机权限、原生 Helper 与长时间截图尚未在本轮完成 | 明确测试设备及安装包，逐项运行真实环境用例并记录；不修改 App ID 绕过权限 |
| 新更新源在线发布：`release-source.json` 与隔离交接记录 | 本轮只验证代码与模拟 GitHub 响应，没有联网核查新仓库匿名 Release 或安装包；隔离交接时新库 Private 且无 Release | Phase 3 复核实际可见性、版本、Release 资产、签名、公证、哈希和匿名下载；先保留旧更新渠道 |
| 自定义 HTTP endpoint：`src/shared/contracts.ts` 允许 HTTP/HTTPS | 支持本地模型；若用户选择远端 HTTP，链路可能明文传输 Key 和内容，本轮未擅自禁用旧合法配置 | Phase 3 明确远端 HTTP 的提示/限制策略，保留本地免 Key 服务并测试已有配置兼容性 |
| 第三方模型与联网工具 | 本轮模型验证为本地协议 fixture，不能据此宣称所有厂商真实模型或第三方网页服务都已通过 | 使用维护者明确选择的服务、支持图片/Tool Calling 的模型和合成数据进行授权验收，记录费用与隐私边界 |
| 开源法律与素材 | `package.json` 仍 UNLICENSED，LICENSE/NOTICE 和素材授权问题没有在本阶段解决 | 确认权利归属与许可证、依赖通知、字体/图标/图片授权后，再决定公开 |

当前没有发现阻断无账号运行的业务缺陷。上述未完成验证不应表述为“全部平台和正式升级已通过”。本阶段不因此修改已正确的存储、截图或 AI 架构。

## 9. Phase 3 的具体输入条件

进入下一阶段前需要明确以下输入，而不是继续假定已有生产能力：

1. **认可本报告和本地差异。** 允许进入哪一项工作需维护者确认；本轮不推送本分支。
2. **正式安装与兼容性样本。** 指定 Mac/Intel/Windows 验收设备、原 v0.2.3 安装包和可备份的数据；真实 Key 不进入 Git、报告或测试 fixture。为升级建立完整数据备份及回退目录，不覆盖唯一副本。
3. **发行方案。** 确认免费版新版本号、源码/发行仓库可见性、官方签名和公证方式、GitHub Release 资产及更新元数据；从旧 `Snipvia-releases` 切换的过渡策略需单独确认，不能停掉老账号版仍依赖的服务。
4. **权限与平台清单。** 补录屏权限、混合 DPI、Helper、DPAPI、安装/卸载和更新后重启的真机用例。没有这些证据不宣称 Windows 与 Intel 正式支持已验收。
5. **可选功能边界。** 如需 Jev / TypeSafe，先确认独立 endpoint、用户配置项和真实输入输出契约，再为无 Key 默认模型路径增加回归；它不是免费核心的前置条件，不恢复官方账号代理。
6. **公开门槛。** 确认许可证与素材授权，复核发布快照和完整可达历史；明确网络隐私说明及自定义 HTTP 策略。不得把 Phase 2 功能验收自动等同于公开、发布或停服授权。

本轮停在验收报告与可审阅的本地改动，等待维护者验收。
