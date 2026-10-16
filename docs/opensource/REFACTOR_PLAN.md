# Snipvia 无账号、本地优先开源重构实施方案

> 状态：已按后续授权先完成公私代码分离、私有远程保全和 Phase 1。当前交付见 [Phase 1 实施报告](PHASE1_REPORT.md)。以下旧架构与行号保留为审计基线；更新源已按维护者新决定提前改为 yuyeyuyy/Snipvia。Phase 2、正式发布与停服尚未执行。
>
> 审计日期：2026-10-16（Asia/Taipei）。本轮只读检查代码，并仅新增本文件；未运行安装、构建、测试、签名、公证、发布、远程请求或部署命令。
>
> 文中的“现状”来自本地代码；“目标”“拟新增”“验收”均为后续工作，不能视为已经实现或通过。

## 1. 产品边界与执行结论

本方案落实以下已经确定的产品决策：

1. macOS / Windows 桌面核心功能免费，不登录、不注册、不验证会员，不依赖官方账号服务。
2. 用户自行配置模型、API Key 或可免 Key 的本地兼容模型。客户端免费不等于第三方模型调用免费。
3. Jev / TypeSafe 为可选的独立决策配置；没有可用配置时，默认由用户选定的视觉大模型预测分支。
4. 保留截图、编辑、AI 对话、AI 笔记、预测分支、Agent、历史、日程草稿及既有平台能力。
5. 原服务端、管理后台、官网及配套部署资料迁入私有归档，停止部署；公有客户端不保留商业版开关。
6. 官方版本检查和安装更新继续使用独立 GitHub Release 渠道。
7. 维持 Main 持有网络、凭据和系统能力，Preload 提供窄接口，Renderer 管理交互的结构。去掉会员授权，不去掉 OS 权限、工作区授权、写入确认、命令沙箱和 IPC 校验。

**推荐实施路线：先移除账号耦合并建立直接大模型预测闭环，再增加可选 Jev，再断开 workspace 和测试依赖，最后完成分仓、发行与停服。**

不新增 AccountService 的“永远免费”替身，不伪造永久会员，不使用本地后台模拟官方服务，不创建 Free/Pro 两套运行架构，也不趁本次任务重写整个 Agent 或截图引擎。

“本地优先”表示本地功能与数据独立于官方账号服务；用户触发的模型调用、可选 Jev、联网搜索和独立更新检查仍可能联网。没有模型配置时，本地截图、编辑、笔记、历史和已有日程仍可使用。

## 2. 审计基线与当前未提交成果

### 2.1 本地基线

| 项目 | 本轮发现 |
| --- | --- |
| Git HEAD | `c414cdd991733ffb8bb4ee88dd53cdb22a691744`，HEAD 的 package.json 为 0.2.1 |
| 工作区版本 | [package.json](../../package.json) 为 0.2.3 |
| 已跟踪修改 | 177 个文件 |
| 未跟踪内容 | 175 个 Git 状态项，展开后为 421 个文件，包含整个目录；不可把两者当作相同统计 |
| 规划前可见源码/资料文件 | Git 跟踪项与未忽略的未跟踪文件合计 893 个 |
| 新规划文件 | 本文件在审计前不存在 |
| 验证方式 | 静态阅读、导入关系检索、配置与工作区检查；本轮没有重新执行测试 |
| 远程状态 | 未查询仓库权限、线上服务、Release 或 Actions；本地发布记录不等于本轮在线验证 |

后续实施必须先保存包含未跟踪文件的本地可恢复基线。仅记录 HEAD 或只保存 tracked diff 不够；不能使用 reset、clean 或丢弃修改恢复到旧版。快照不得夹带真实环境文件、数据库、钥匙串和安装包。基线清单应记录文件名、状态、内容摘要及源码 SHA，不记录密钥值。

### 2.2 不能丢失的当前成果

下列内容确实存在于当前工作区，其中重要模块尚未跟踪；附录 A 给出具体文件清单。

| 功能 | 关键文件/目录 | 保存要求 |
| --- | --- | --- |
| 主窗口 AI 对话工作区 | [chat/](../../src/renderer/src/chat/)、[AppShell.tsx](../../src/renderer/src/components/AppShell.tsx) | 保留会话侧栏、模型恢复、重命名、停止/重新生成和滚动状态 |
| 图片导入、粘贴、拖放、历史附件 | [main/chat/](../../src/main/chat/)、[storage/chat-images.ts](../../src/main/storage/chat-images.ts)、[shared/chat-images.ts](../../src/shared/chat-images.ts) | 保留图片验证、会话隔离、持久化及孤儿清理 |
| AI 修改建议与确认保存 | [agent/editing/](../../src/main/agent/editing/)、[EditingPanel.tsx](../../src/renderer/src/chat/EditingPanel.tsx) | 保留差异确认、冲突校验和不完整提案不执行 |
| 模型目录与图片能力 | [ai/models/](../../src/main/ai/models/)、[ModelSelectRow.tsx](../../src/renderer/src/settings/ModelSelectRow.tsx) | 保留厂商适配、24 小时缓存、手动 ID、显式付费测试 |
| 主题与双套 UI 语言 | [design/](../../src/renderer/src/design/)、[components/ui/](../../src/renderer/src/components/ui/) | 保留 Light/Dark/System、跨窗口同步、工作区与分组设置 |
| 截图延迟和 Windows 适配 | [capture-engine.ts](../../src/main/capture/capture-engine.ts)、[electron-capture-backend.ts](../../src/main/capture/electron-capture-backend.ts)、窗口管理器与相应测试 | 移除账号等待，不回退到旧截图状态机 |
| 正式 Mac 签名与更新 | [updates/](../../src/main/updates/)、[scripts/macos-release/](../../scripts/macos-release/)、正式配置与 entitlements | 保留发布白名单、签名链、用户确认安装和保存笔记检查 |
| Windows 构建和校验 | [package-windows.mjs](../../scripts/package-windows.mjs)、[verify-windows-build.mjs](../../scripts/verify-windows-build.mjs)、专用配置与工作流 | 保留独立输出、未签名定位及安装/卸载测试 |
| Agent 长对话、笔记写入与撤销 | [AgentExecutionService.ts](../../src/main/agent/ui/AgentExecutionService.ts)、[AgentSessionStore.ts](../../src/main/agent/AgentSessionStore.ts)、[NoteCheckpoints.ts](../../src/main/agent/notes/NoteCheckpoints.ts) | 保留上下文、真实执行结果、确认、检查点及重启恢复 |

服务端资格模板、活动兑换、回收、后台主题和官网也有未提交/未跟踪成果。它们应完整私有归档，不能把“从公有客户端移除”理解为“可以丢弃”。

## 3. 当前架构与账号依赖

### 3.1 当前模块关系

~~~mermaid
flowchart TD
  UI["Renderer: App / AccountPanel / Chat / Notes"] --> Bridge["Preload: SnipviaAPI"]
  Bridge --> Main["Main: index.ts / IPC / 服务组装"]
  Main --> Account["AccountService"]
  Account --> Cookie["AccountSessionStore + safeStorage"]
  Account --> Official["官方账号/资格/预测 API"]
  Official --> Server["Fastify + better-auth + SQLite"]
  Server --> Vision["服务端配置的视觉厂商"]
  Server --> Jev["TypeSafe Jev 文字预测"]
  Main --> UserModel["用户配置的 Chat Completions 模型"]
  Main --> Local["截图引擎 / Swift Helper / 笔记 / 历史 / Agent"]
  Main --> Updates["UpdateCheckService / ElectronUpdateInstaller"]
  Updates --> Release["独立 GitHub Release"]
  Contract["packages/console-contracts"] --> Account
  Contract --> Server
  Contract --> Admin["apps/console"]
  Contract --> Failures["PredictionError / 会员判断"]
~~~

上图描述现有运行与源码依赖，不表示所有请求都会同时发生。账号本身的主要流量由 Renderer 启动时调用 account.get() 触发；中央预测在用户启动预测时发生。

### 3.2 账号、Cookie 和官方服务依赖清单

| 层次 | 实际证据 | 当前职责与重构动作 |
| --- | --- | --- |
| Renderer 启动 | [App.tsx:40](../../src/renderer/src/App.tsx#L40) | 订阅 account:changed、调用 account.get()；移除，不保留启动配置请求 |
| 账号 UI | [AccountPanel.tsx](../../src/renderer/src/account/AccountPanel.tsx)、[AppTitleBar.tsx](../../src/renderer/src/components/AppTitleBar.tsx)、[AppShell.tsx](../../src/renderer/src/components/AppShell.tsx) | 邮箱验证码、登录/注册、资格显示、命令面板入口；移出公有客户端 |
| Preload | [index.ts:70](../../src/preload/index.ts#L70) | 暴露 get/sendCode/signIn/signOut/onChanged；移除整个 account API |
| 公共 IPC 类型 | [contracts.ts:229](../../src/shared/contracts.ts#L229)、[shared/account.ts](../../src/shared/account.ts) | 账号 API 和状态类型；移除，不能只隐藏按钮 |
| Main IPC | [index.ts:1534](../../src/main/index.ts#L1534) | account:get/send-code/sign-in/sign-out；移除注册与通知 |
| 资格策略 | [screenshot-chat-access.ts](../../src/shared/screenshot-chat-access.ts) | 检查登录、连接、邮箱验证、账号状态、到期资格；删除商业访问策略 |
| 账号业务 | [AccountService.ts](../../src/main/account/AccountService.ts) | /api/config、get-session、/api/me、OTP、sign-out、预测服务发现与转发；从客户端移除 |
| Cookie 存储 | [storage/account.ts](../../src/main/storage/account.ts) | 加密保存 account/session.json，绑定 origin、过期和 Cookie 格式；停止读取，不向新预测服务移植 |
| 默认服务来源 | [AccountService.ts:15](../../src/main/account/AccountService.ts#L15)、[index.ts:1952](../../src/main/index.ts#L1952) | 默认账号域名，MAIN_VITE_CONSOLE_ORIGIN / SNIPVIA_CONSOLE_ORIGIN 覆盖；删除客户端入口 |
| 到期中断 | [index.ts:531](../../src/main/index.ts#L531)、[index.ts:1959](../../src/main/index.ts#L1959) | onChanged、membershipExpiryTimer、stopMembershipTasks 会停止 AI/Agent；删除会员驱动中断，保留用户取消 |
| 服务端 | [app.ts](../../apps/server/src/app.ts)、[decisions.ts:24](../../apps/server/src/decisions.ts#L24) | 登录、MFA、会员、配额、统计和模型代理；私有归档，客户端不再访问 |

账号加密做得较窄，Cookie 不进入 Renderer；但是否允许使用 AI 并不只由前端控制，而是多处 Main 强制检查。

### 3.3 Main 中必须逐项拆除的强制检查

以下均在 [src/main/index.ts](../../src/main/index.ts)，行号以本轮基线为准：

| 位置/入口 | 当前影响 | 目标处理 |
| --- | --- | --- |
| 164：NotebookWriter.beforeWrite | AI 写笔记前验证资格 | 只移除资格检查；保留 flush、diff 确认和冲突检查 |
| 202：EditingProposals.beforeWrite | 笔记/分支提案应用前验证资格 | 保留保存与提案安全检查 |
| 998–1010：startCapture | 无资格 AI 截图变为普通截图；并行启动资格校验 | 删除降级、captureAccessChecks 和账号 notice；保留普通/AI 两种真实截图意图 |
| 1111–1162：presentAiCapture | 校验后才建立 AI 会话；存在临时 pin 与 checkingAccess | 去掉账号等待，保留窗口复用、会话身份、迟到结果检查和普通 localPin |
| 1358：agent:workspace-start | 主窗口 AI 对话也受会员限制 | 删除资格检查；保留会话、图片 lease、参数及 sender 校验 |
| 1390：agent:start | 截图 Agent 入口受限 | 删除资格检查；保留 notebook/workspace 与工具权限 |
| 1709：capture:import | 图片导入 AI 受限 | 免费开放；保留文件大小、解码和本地对话处理 |
| 1739–1740：pin:start-chat | 等待资格/验证资格 | 删除账号等待；普通截图“问 AI”继续可用 |
| 1797：chat:send | 普通非流式截图对话受限 | 改为本地模型配置检查 |
| 1838：chat:stream | 流式截图对话受限 | 同上，保留取消和超时 |
| 1850：auto-action:start | 空输入 Enter 触发预测前验证资格 | 改为本地预测配置检查 |
| 1952–1974：启动组装 | 创建账号服务和到期定时器 | 不组装账号服务，不启动官方请求 |

补充清理 captureAccessChecks 在 cleanupOverlay 中的删除，以及 pendingAiPinSession 在 closePinnedFlow 等处的重置，不能留下半个状态机。若异步呈现仍需要局部会话保护，使用捕获 session/generation 检查，不能用新名字保留“等待资格”。

Renderer 的账号入口、capture-membership-notice 和提示文字属于展示；它们不是唯一限制。Preload 是桥，不进行会员验证。AgentLoop、NotebookService 和本地历史服务本身没有统一登录模型，适合继续保留。

### 3.4 原本就不应被误删的本地与安全能力

- 普通截图、标注、复制、保存和贴图不要求会员；去账号后继续保留普通与 AI 入口的交互差别。
- 本地笔记手工编辑、附件和历史浏览不需要官方服务。
- 主窗口 Agent context.readOnly 只开放问答、联网与结构化修改提案，截图绑定笔记本的 Agent 才有相应笔记/命令范围。这是权限边界，不是会员限制。
- createFileToolSystem 的 allowed permissions、外部 MCP 执行限制、单次 diff 确认不能因为“全部免费”被删除。
- Main 只在 darwin 组装 commands；Windows 没有已接入的产品命令沙箱。保留 Windows 的 Agent 问答/检索/既有笔记能力，命令执行继续禁用，另设后续平台任务。
- 外部 MCP 连接代码存在，会在明确授权后尝试连接用户配置的进程；但产品工具注册允许清单不开放 external:execute。保留现状，不新增无沙箱执行通道。
- OS 录屏权限、Mac 自动化权限、工作区目录授权、文件冲突和画像能力校验继续有效。
- ProcessSandbox 使用 ELECTRON_RUN_AS_NODE 启动内置 Node；不能在本次发行加固中直接禁用该 fuse 而破坏脚本能力。

## 4. 当前预测链路与契约

### 4.1 触发和执行

1. AI 框选完成后创建本地截图/对话；新截图进入 awaiting_input，续拍为 idle。
2. QuickChat 或 pin 的空输入 Enter 调用 auto-action:start；正常输入走手动对话。保留这一显式触发，不能改成截图后自动上传。
3. beginAutoUnderstanding 通过 ScreenshotAnalyzer 先调用本机 OCR，再尝试中央预测。
4. 有启用的中央服务时：AccountService 使用账号 Cookie 发现 /api/me/prediction-service，然后把裁剪 JPEG/PNG 与启用分支的 id/applicableContent 发给 /api/predictions/screenshot。
5. 中央服务验证登录、资格与配额；视觉模型先输出文字描述，再由 Jev 预测分支。
6. 中央服务返回 null 时才继续本机/OCR/用户视觉模型路线。中央请求失败时返回 predictionError，不自动把同一图再发往另一预测厂商。
7. AutoActionRouter 校验启用分支与阈值。confidence 小于 0.65 等待手动输入；0.65 至小于 0.82 的自动动作有 700ms 推荐等待；schedule 另要求 hasSchedule。
8. AI 分支进入 Agent；日程分支调用用户模型提取草稿；OCR 动作展示本机识别文字。日程仍需用户确认后保存或写入 Mac 系统应用。

依据：[beginAutoUnderstanding](../../src/main/index.ts#L842)、[ScreenshotAnalyzer](../../src/main/analysis/screenshot-analyzer.ts#L129)、[AutoActionRouter](../../src/main/analysis/auto-action-router.ts#L41)、[executeAutoAction](../../src/main/index.ts#L775)。

现有 OCR 高置信度可直接路由默认分支，修改过适用条件才强制语义预测。新产品要求无 Jev 时使用大模型，必须有意调整此行为，不能仅删除 classifyWithServer 后照旧。

### 4.2 三种已有契约不是同一层

| 契约 | 来源 | 实际内容与约束 |
| --- | --- | --- |
| 客户端分支与结果 | [screenshot-understanding.ts](../../src/shared/screenshot-understanding.ts) | 最多 30 分支；支持 builtin/custom UUID、条件、执行 prompt、notebookId、mode；结果含 contentType、confidence、recommendedAction、可选 matchedBranchId 与 signals |
| 中央截图代理 HTTP | [prediction.ts:50](../../packages/console-contracts/src/prediction.ts#L50) | image 最大 2,000,000 字符且为 JPEG/PNG data URL；分支只含 id 与 applicableContent；响应严格要求 matchedBranchId 和 hasSchedule；不接收执行 prompt 或 notebookId |
| TypeSafe 外部协议 | [typesafe.ts](../../packages/console-contracts/src/typesafe.ts) | model、state、questions；choice/noul/score 答案和 usage；问题名、类型、选项、概率和评分范围均需校验 |

Jev 在现有实现中是**文字/JSON 决策模型**，不是截图视觉模型。predictionServiceSchema 的 input:image 表示旧代理接受图片，不表示 TypeSafe 原生接受图片。validateTypeSafeTextInput 明确拒绝 image_url、input_image、data:image 等。

### 4.3 服务端视觉与 Jev 的真实过程

[apps/server/src/prediction-pipeline.ts](../../apps/server/src/prediction-pipeline.ts) 当前实现：

- OpenAI 使用 /responses，设置 store:false，发送 input_image。
- Qwen 使用 /chat/completions，发送 image_url。
- Gemini 使用原生 generateContent，发送 inlineData。
- 视觉描述要求只转录/描述可见信息，不回答、不执行、不跟随图中文字指令；结果长度 1–8192 字符。
- Jev 请求固定到 https://api.typesafe.ai/v1/systemone，以 Bearer Key 调用；model 来自服务端配置。
- state 为 screenshot_description；questions 包含 branch(choice)、content_type(choice)、has_schedule(noul)。
- 分支映射为 branch_0…branch_n，加 none，再映回原始 id；hasSchedule 使用 noul >= 0.82；分支是否执行还受客户端 0.65 阈值约束。
- 用户执行 prompt、notebookId 不进入 Jev 分类。
- 配额、会员、用量累计、管理员配置和服务端根秘密加密属于旧托管服务，不应迁入客户端。

### 4.4 已有直接大模型路径可以复用

[ai/provider.ts:169](../../src/main/ai/provider.ts#L169) 的 classifyScreenshot 已直接调用用户 endpoint 的 /chat/completions，发送裁剪图和启用分支条件，要求输出 JSON。parseScreenshotClassification 已检查类型、置信度及分支 id 是否启用。

因此**无需原服务器即可完成分支预测**，不需要重建本地 HTTP 服务。仍需解决：

- 统一失败表达，避免现有 catch 把模型错误吞掉后又按 OCR 路由。
- 明确要求 matchedBranchId 为有效启用 id 或 null，不让格式不完整结果进入按内容类型猜测的旧路径。
- 当前 max_tokens:220 对最多 30 分支和结构化结果需用测试评估，不能宣称任意模型都兼容。
- 模型目录“可见/支持图片”不等于结构化输出或 Tool Calling 已获真实验证；未知能力不自动触发额外付费探测。
- 分类、执行、日程提取使用同一用户模型配置的快照；未配置/鉴权失败应指向用户设置，不再提示联系管理员。

## 5. 目标架构

### 5.1 模块关系

~~~mermaid
flowchart TD
  UI["Renderer: Chat / Notes / Capture / Settings"] --> Bridge["窄 Preload / Zod IPC"]
  Bridge --> Main["Main: 生命周期与服务组装"]
  Main --> Local["截图 / Swift / 本地存储 / 笔记 / Agent"]
  Main --> Predict["PredictionService: 本地路由与结果归一"]
  Predict --> Settings["用户模型配置 + 可选 Jev 配置"]
  Settings --> Secret["Main safeStorage，Renderer 仅配置状态"]
  Predict --> LLM["无 Jev: 用户视觉模型直接分类"]
  Predict --> Desc["启用 Jev: 用户视觉模型生成描述"]
  Desc --> Jev["用户 Key 直连 TypeSafe，仅文字/条件"]
  LLM --> Normalize["同一 ScreenshotAnalysis 与 AutoActionRouter"]
  Jev --> Normalize
  Normalize --> Action["既有 Agent / OCR / 日程草稿"]
  Main --> Update["现有独立更新服务"]
  Update --> Github["Snipvia-releases: 检查 / ZIP / DMG"]
  Legacy["私有归档: server / console / website / 旧契约"] -.无运行或构建依赖.-> Main
~~~

虚线只表达必须消除的依赖，最终公有客户端不导入私有归档。不增加核心 SDK、商业授权插件或通用后端注册平台。开始仅支持 llm 与 typesafe 两条小型策略。

### 5.2 预测后端选择与失败规则

| 状态 | 目标行为 |
| --- | --- |
| 所有分支关闭 | 不发预测请求，等待手动输入 |
| Jev 未启用或没有配置 Key | 自动使用用户选定的视觉模型直接分类，不访问官方账号服务，不报“缺 Jev Key” |
| Jev 已启用且有 Key | 用户视觉模型生成文字描述，再用用户 Jev Key 直连 TypeSafe |
| Jev Key 无法解密、格式错误或被拒绝 | 显示本地配置/鉴权问题；不将它伪装成“没有 Key”静默转发 |
| 已配置 Jev 调用失败 | 保留可见失败及显式重试；建议提供“使用当前大模型重试”，不在后台自动多发一次收费请求 |
| 用户视觉模型未配置 | 本地功能继续可用；实际发起 AI 时提示配置模型，并在发网前停止 |
| 自定义本机模型无需 Key | 保留现有空 Key 使用能力，不强制所有配置都有 Key |
| 已明确不支持图片 | 不上传截图，提示切换视觉模型；未知能力保留明确提示与用户主动测试/调用路径 |
| 分类无匹配、低置信度、无效 JSON、停用 id | 等待用户，不自动执行本地分支或保存笔记 |
| 用户输入、停止、续拍、关闭或切换配置 | 取消旧操作，迟到响应不改变新会话，不触发工具或日程写入 |

现状只规定“没有 Jev Key 的自动选择”。“配置了 Jev 但失败后如何回退”采用上述可见失败、显式重试策略，属于本方案的建议，避免把无 Key 回退扩展成未告知的重复上传。

### 5.3 最小模块设计

以下均为拟新增，不表示目前已有这些文件。

| 文件 | 职责 |
| --- | --- |
| `src/main/analysis/PredictionService.ts` | 根据启用状态/Key 选择后端；冻结分支与模型快照；归一结果与错误；不持有账号或 Cookie |
| `src/main/ai/prediction-description.ts` | 通过已有用户 Chat Completions 配置生成有界视觉描述；不复制服务端三套原生厂商配置 |
| `src/main/ai/typesafe/TypeSafeClient.ts` | 固定 HTTPS TypeSafe 地址、Bearer Key、有界 JSON、超时/取消与脱敏错误 |
| `src/main/ai/typesafe/contracts.ts` | 提取所需外部协议与校验；不引入会员、订单、用户或旧服务发现契约 |
| `src/main/ai/typesafe/branch-prediction.ts` | 从启用分支构建三问题请求，校验并映射回 ScreenshotAnalysis |
| `src/main/ai/json-request.ts` | 合并调用方取消与预算超时，限制响应字节，禁止重定向并清理 reader |
| `src/main/storage/prediction-settings.ts` | 独立保存可选 Jev 配置与 safeStorage 密文 |
| `src/shared/prediction-settings.ts` | 无秘密公共视图、保存请求 schema 与窄 IPC 类型 |
| `src/shared/prediction-failure.ts` | 客户端可用的 vision/branch/configuration 错误与用户自助修复提示 |
| `src/renderer/src/settings/PredictionSettings.tsx` | 设置语言的可选 Jev 分组，显示自动使用的大模型与配置状态 |

Phase 1 先只使用 LLM，不要求提前实现可选 Jev。Phase 2 再加入表中 Jev 文件，避免第一阶段同时迁移两条网络路径。

已有 [ai/models/http.ts:10](../../src/main/ai/models/http.ts#L10) 会用自己的 timeout signal 覆盖传入 signal，不能原样当作可取消预测传输。新传输只做必要提取，不顺带重构所有模型目录适配。

### 5.4 结果、安全与费用边界

- 两条后端均输出现有 ScreenshotAnalysis。recommendedAction 由可信本地规则根据已验证 matchedBranchId 决定，不接受模型给出的任意动作。
- 保留分支上限、条件长度、UUID、启用状态、schedule 信号与 0.65/0.82 行为；OCR 的启发式候选仅辅助/诊断，不能替代无 Jev 时要求的大模型分支选择。
- Jev 路径仍先用视觉大模型理解图片；不能仅把 Windows 上为空的 OCR 或不完整文字当作全部截图语义。
- LLM 路径一般为一次分类请求，Jev 路径一般为视觉描述加 Jev 两次请求；之后 AI 执行/日程提取可能另有调用。设置和隐私文案明确这一点，不承诺模型费免费。
- 请求绑定捕获 id、operationId、配置 revision/摘要；返回后与执行前检查仍有效，分支编辑/删除后不得执行旧匹配结果。
- 分支分类只发送 id、条件及必要 mode 信息，不发送 notebook 路径、笔记正文或执行 prompt；执行时再按现有授权获得上下文。
- TypeSafe 不接收原图和用户大模型 Key；用户模型不接收 Jev Key；新 Key 不进入日志、工具参数、历史或命令环境。
- 非本机模型端点默认 HTTPS；本机兼容模型保留 HTTP。收紧旧自定义公网 HTTP 时给出可见迁移提示，不静默改地址或清空凭据。
- 新 Jev IPC 只允许主窗口配置，严格验证参数和 sender；不增加 Renderer 任意 URL fetch、读密钥或通用 invoke 接口。

## 6. 功能保留 / 删除 / 迁移矩阵

| 功能 | 公有客户端目标 | 私有归档/后续处理 |
| --- | --- | --- |
| 截图、普通编辑器、复制/保存/贴图 | 保留，免费，不受模型或账号状态阻塞 | 不迁移 |
| AI 截图、导入、续拍、流式问答 | 保留，使用自有模型 | 删除会员前置检查 |
| AI 对话工作区及消息图片 | 保留完整当前实现 | 不回退到 HEAD 旧界面 |
| AI 笔记、Markdown、附件、导出 | 保留；AI 修改仍确认 | 不新增同步/托管存储 |
| 自定义预测条件、顺序、执行 prompt、笔记本绑定 | 保留，保持 id 和数据 | 只迁出后台配置/统计 |
| 默认预测 | 用户视觉模型直接分类 | 删除官方代理依赖 |
| 可选 Jev | 新增用户配置后直连；默认可不用 | 仅提取协议与分类映射 |
| Agent 循环、网络检索、工作区读、笔记提案/确认/撤销 | 保留现有权限范围 | 不引入账号 ACL |
| 沙箱命令 | 保留当前 macOS 能力；Windows 暂禁用 | Windows 沙箱单独规划，不能无隔离开放 |
| 通用直接文件改写与外部 MCP 工具执行 | 保留底层代码及已有禁用状态 | 不因免费而扩大执行权限；MCP 启动仍需用户授权 |
| 本机 OCR | 保留；macOS 用 Swift Helper，Windows 可不可用 | 不虚构 Windows 原生 OCR |
| 本地日程、Mac 日历/提醒事项写入 | 保留现有草稿/确认和平台限制 | ICS、同步、去重等未完成项不纳入本次实现承诺 |
| 历史、附件、Agent 会话与检查点 | 保留、兼容旧数据 | 不关联/上传账号数据 |
| 模型配置、目录缓存、手动 ID、能力测试 | 保留 | 不替换为中央模型目录 |
| 登录、注册、验证码、会员/体验资格、到期计时 | 从客户端删除 | 旧实现私有归档 |
| Cookie、账号恢复、官方预测发现与转发 | 从运行时/API 删除 | 原用户本地遗留密文先不读取、不自动删除 |
| 用户/订单/活动/资格/限额/管理 MFA | 公有客户端不保留 | apps/server、apps/console 私有归档 |
| 官网、品牌页面及部署镜像 | 不作为客户端依赖 | apps/website 私有归档，停止部署 |
| GitHub Release 检查与 Mac 签名更新 | 保留，匿名使用独立渠道 | 不跟随官网关闭 |
| Windows 更新 | 保留检查与手动安装 | 不宣称已有签名自动安装；后续独立完善 |
| 开机自启 | 保留 | login-item 是 OS 启动项，不是账号登录，不能按 login 关键词误删 |

## 7. 公私边界与 workspace 断开

### 7.1 当前实际耦合

| 边界 | 证据 | 断开方式 |
| --- | --- | --- |
| 桌面 runtime → 旧契约 | AccountService、PredictionError、screenshot-chat-access 相对导入 packages/console-contracts/src | 删除账号依赖；只将客户端预测错误/TypeSafe 协议提取到 src 内 |
| 桌面 build → 旧契约 build | package.json 的 build 首先执行 pnpm --filter @snipvia/console-contracts build | 提取完成后改为桌面 typecheck + electron-vite build |
| 默认单测 → 后端 | Vitest 收集所有 tests/**/*.test.ts；console*.test.ts 引入 Fastify/SQLite | 服务测试私有迁移；桌面预测契约用例单独保留 |
| 大量 Electron 测试 → 后端 | tests/helpers/desktop-account.ts 启动 createConsoleApp，创建用户并发放资格 | 替换成纯桌面临时数据/模型 mock helper |
| 类型检查 → 私有测试/配置 | tsconfig 包含 tests 与 *.config.ts，playwright.console.config.ts 引用私有启动命令 | 迁出私有测试与配置后再移除私有源码；不能靠 skip 类型错误完成 |
| Vitest alias → 私有包 | vitest.config.ts 指向 packages/console-contracts/src/index.ts | 确认无消费者后移除 alias |
| workspace/安装 → 私有 apps | pnpm-workspace.yaml 包含 apps/*、packages/* | 公有端仅根包，保留 pnpm-workspace.yaml 里的必要覆盖和构建允许策略 |
| 管理后台 → 桌面 UI | apps/console/src/components.tsx 引用 Icon、WorkspaceHeader；style.css 引用 tokens.css | 私有端保存最小 UI 快照并改导入，不能要求公有端长期保留隐形跨仓路径 |
| 私有服务测试 → 桌面业务 | tests/unit/console-typesafe.test.ts 引用 defaultPredictionBranches、autoActionRouter，并混合 AccountService/AccountSessionStore | 桌面路由断言移到公有预测测试；私有代理测试使用自身分支 fixture，不能把整个桌面运行时复制进私有构建 |
| Docker → 公私混合上下文 | 根 .dockerignore 和 server Dockerfile 复制桌面 UI、契约与后台 | 配套迁入私有端，修正上下文，不带真实运行数据 |
| 发布 → 官网 | 仅部分日志/文档称“官网可分发”；真实更新地址在 release-source.json | 改文案，不删正式发布器 |
| 官网下载配置 → Release | apps/website/src/config.ts 写死下载链接 | 官网归档不影响 Release，客户端不读取官网配置 |

根 dependencies 没有直接声明 Fastify、better-auth 或 better-sqlite3，但这些会由私有工作区和桌面测试带入全仓安装。不要为“去后端”删除 Zod、Ajv、MCP SDK 等仍被桌面使用的库。

### 7.2 目标目录

~~~text
Snipvia 公有客户端/
├── src/{main,preload,renderer,shared}/
├── native/screen-capture-kit-helper/
├── UI/
├── build/                         图标与权限输入
├── scripts/                       桌面构建、性能与发布
├── tests/{unit,integration,helpers,fixtures}/
├── docs/                          客户端与开源文档
├── .github/workflows/
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml            根包及必要策略，不再包含私有工作区
└── electron-builder*.{yml,cjs}

私有归档/
├── apps/{server,console,website}/
├── packages/console-contracts/    保留旧服务契约
├── scripts/                       服务/官网镜像、部署与评估
├── tests/                         服务、账号与控制台测试
├── docs/                          运维、账号与官网资料
└── shared-ui/                     私有端需要的最小冻结 UI 输入
~~~

这是目标布局，不在本轮创建、移动或删除目录。没有新增公有 core 包的必要。

### 7.3 Git 历史边界

把目录从当前 tree 移走，不能让历史中的 server/console/website 自动变成私有。本地 Git 历史已经包含这些目录。

推荐保留完整旧仓库及本轮未提交基线作为私有历史，后续从审查后的桌面快照建立公有源码仓库，记录来源 SHA、贡献者和许可来源；独立 Release 仓库保持原地址。若选择复用并公开当前 Git 仓库，需要另行批准历史筛选方案，不能默认执行重写、force push 或改权限。

迁移私有源码不等于把 .env、数据库、SMTP 密码、模型 Key、镜像登录凭据一并提交到新仓库。运行数据和凭据走受控备份/交接渠道。

## 8. 精确到文件的实施清单

### 8.1 Phase 1：无账号客户端与默认 LLM 预测

| 文件 | 计划修改 |
| --- | --- |
| `src/main/index.ts` | 按 3.3 逐项移除账号 import、组装、计时、检查和 IPC；接本地预测；保留快照、session、取消、窗口、图片 lease、flush 和确认；legacy account 目录仍作为受保护旧数据路径 |
| `src/main/account/AccountService.ts` | 在基线保存后移出公有运行源码；不留 return true 替身 |
| `src/main/storage/account.ts` | 移出公有运行源码；旧文件不再读取/解密 |
| `src/shared/account.ts` | 删除客户端账号类型；旧测试/私有资料归档引用改正 |
| `src/shared/screenshot-chat-access.ts` | 删除会员策略与错误类型 |
| `src/shared/contracts.ts` | 移除 SnipviaAPI.account 与 checkingAccess；localOnly 保留普通贴图语义；扩展后续预测设置桥类型时独立处理 |
| `src/preload/index.ts` | 移除 account 方法/事件订阅，保留所有实际本地桥与 sender 角色边界 |
| `src/renderer/src/App.tsx` | 移除账号 state/effect/AccountPanel/页面分支与 signedIn 传参，主窗口不再刷新账号 |
| `src/renderer/src/components/AppShell.tsx` | 移除 account AppPage 与快捷导航项，保留四主入口和设置 |
| `src/renderer/src/components/AppTitleBar.tsx` | 移除登录按钮和 signedIn/accountActive/onAccount props |
| `src/renderer/src/account/AccountPanel.tsx`、`account.css` | 基线保存后移出公有端 |
| `src/renderer/src/design/app-shell.css` | 删除 titlebar-login 等仅账号样式，不重排整套布局 |
| `src/renderer/src/capture/CaptureOverlay.tsx`、`capture-window.css` | 删除会员降级 notice 和专属样式；如保留通用 notice，明确为捕获错误而非商业状态 |
| `src/renderer/src/capture/PinnedCapture.tsx` | 核对 localOnly/AI id/Enter；保留普通贴图“问 AI”、Esc、复制和复用 |
| `src/renderer/src/chat/QuickChat.tsx` | 核对无模型提示、手动问答、空输入预测、续拍与停止；不新增登录路径 |
| `src/main/analysis/screenshot-analyzer.ts` | 去掉 classifyWithServer 注入；默认走用户视觉模型；保留 OCR 但取消其代替默认大模型分支预测的捷径；失败可见且不猜动作 |
| `src/main/analysis/PredictionError.ts` | 改用客户端本地错误契约 |
| `src/shared/prediction-failure.ts`（新） | 错误文案面向用户设置，去除 service/proxy 的账号含义；不依赖私有包 |
| `src/main/analysis/PredictionService.ts`（新） | 第一阶段仅 LLM 策略，统一快照、分支 id/null、错误与取消 |
| `src/main/ai/provider.ts` | 保留问答、分类、日程提取；强化分类输出、字节/结束边界，使用可信本地动作映射 |
| `src/main/ai/json-request.ts`（新） | 为分类与后续 Jev 提供有界、可取消传输 |
| `src/main/analysis/auto-action-router.ts` | 保持既有阈值和 schedule 安全条件；只在统一结果要求下必要收紧，不改业务分支 id |
| `src/shared/screenshot-understanding.ts` | 保留旧历史 id、分支字段及数据兼容；统一分类结果要求 |
| `src/main/agent/ui/AgentExecutionService.ts`、`agent/notes/NotebookWriter.ts`、`agent/editing/EditingProposals.ts` | 主要核对 hook 与上下文；不把去会员扩大成去权限，非必要不改循环 |
| `tests/helpers/desktop.ts`（新） | 不启动服务端、不创建账号；临时目录、模型 mock、网络拒绝策略 |
| `tests/helpers/desktop-account.ts` | 桌面消费者迁至新 helper，旧账号 helper 暂随旧服务测试保留到 Phase 3 |
| `tests/unit/account.test.ts`、`screenshot-chat-access.test.ts`、`tests/integration/account.spec.ts` | 保存到本地恢复基线后从当前测试集移除旧账号用例，以无账号验收替代；不为保留旧用例留下账号运行时 |
| `tests/integration/screenshot-membership.spec.ts` | 核心断言改成无需登录可使用；计划重命名为 `local-first.spec.ts` |
| `tests/integration/capture-account-latency.spec.ts` | 改为网络停滞不影响本地框选/贴图；计划重命名为 `capture-local-first-latency.spec.ts` |
| `tests/integration/prediction-errors.spec.ts` | 改 mock 本机直接模型；保留阶段错误、显式重试、手动聊天可用断言 |
| `tests/unit/console-typesafe.test.ts` | 旧 AccountService 客户端用例及 AccountSessionStore 等配套 import 随账号实现保存到恢复基线，当前文件移除这些用例；剩余服务用例暂保持，协议/分类断言后续提取 |
| `tests/unit/provider.test.ts`、`screenshot-analyzer.test.ts`、`contracts.test.ts`、`agent-execution-ui.test.ts` | 调整契约与新预测路径；保留原安全断言 |
| `tests/unit/prediction-service.test.ts`（新）、`tests/integration/local-first.spec.ts`（改名） | 覆盖零登录/无服务器、大模型默认预测、取消与无配置行为 |
| `.github/workflows/windows-internal.yml`、`docs/ci/windows-release.yml` | Phase 1 即替换已移除/改名的 account、screenshot-membership 测试入口，避免工作流引用失效；完整纯客户端 CI 在 Phase 4 完善 |
| `README.md`、`docs/PRD.md`、`docs/TECHNICAL_DESIGN.md`、`docs/UI_DESIGN_LANGUAGE.md`、`docs/DEVELOPMENT.md`、`docs/PROJECT_STRUCTURE.md` | 同步免费、无账号、直接模型路径；遵守原工作区/设置双语言 |

附录 B 的 32 个 helper 消费者均在 Phase 1 逐个改动/核对；不能删除整批 Agent、图片、笔记或截图测试来消除后端依赖。Windows 等文件如果只依赖测试文案或选择器，也应保留原断言目的。

Phase 1 的“归档”指保存到本地恢复基线，不创建或移动远程仓库。旧账号源码与专用测试可以在基线核对后从当前运行/测试 tree 移除；私有服务、整个 console-contracts 包及剩余服务测试暂不移动，默认全仓测试仍可使用它们。不得把未迁完的旧账号测试简单标记 skip 来获得通过。

### 8.2 Phase 2：可选 Jev 与配置

| 文件 | 计划修改 |
| --- | --- |
| `src/shared/prediction-settings.ts`、`src/main/storage/prediction-settings.ts`（新） | 独立配置、safeStorage 密文、公共 hasKey 视图、原子写入 |
| `src/main/ai/typesafe/contracts.ts`（新） | 从旧 typesafe.ts 提取所需请求/响应校验，补充响应 model、问题名、类型、概率和选项一致性检查 |
| `src/main/ai/typesafe/TypeSafeClient.ts`、`branch-prediction.ts`（新） | 直连和分支映射，完全不导入私有服务 store/config/BusinessError |
| `src/main/ai/prediction-description.ts`（新） | 复用用户模型配置生成描述，不依赖服务端专属视觉 Key |
| `src/main/analysis/PredictionService.ts` | 加入可选 Jev；无 Key 自动 LLM；配置损坏、鉴权失败与明确回退分开 |
| `src/main/index.ts`、`src/preload/index.ts`、`src/shared/contracts.ts` | 增加窄 prediction 配置 get/save/onChanged 桥；只主窗口可保存，不回显 Key |
| `src/renderer/src/settings/PredictionSettings.tsx`（新） | 设置分组：当前默认模型、可选 Jev、模型 ID、Key/清除与费用说明 |
| `src/renderer/src/settings/SettingsPanel.tsx`、`settings.css` | 删除“分支预测使用后台配置”；更新隐私和分类/执行区别，沿用分组行语言 |
| `src/main/storage/settings.ts`、`src/shared/providers.ts`、`src/shared/contracts.ts` | 保持旧模型/Key scope 和 profiles；HTTP 迁移只做明确安全调整，不重置配置 |
| `tests/unit/typesafe-client.test.ts`、`typesafe-branch.test.ts`、`prediction-settings.test.ts`（新） | 协议、Key 隔离、配置损坏、超时/取消、无 Key 回退、重启与清除 |
| `tests/integration/prediction-settings.spec.ts`（新）、`prediction-errors.spec.ts`、`prediction-criteria.spec.ts` | 默认/Jev 两条路径、错误阶段、改条件与配置切换 |
| `docs/AUTO_SCREENSHOT_UNDERSTANDING.md`、`docs/DESKTOP_MODEL_PROVIDERS.md`、`docs/MODEL_DISCOVERY.md` | 说明用户模型、可选 Jev、能力与费用边界 |

### 8.3 Phase 3：workspace、测试、脚本与私有归档准备

| 文件/范围 | 计划修改 |
| --- | --- |
| `apps/server/`、`apps/console/`、`apps/website/` | 整目录含未跟踪成果迁入私有归档候选，验证后才从公有候选排除 |
| `packages/console-contracts/` | 整包留私有端；公有端只保留已提取的最小客户端协议 |
| `apps/console/src/components.tsx`、`style.css` | 私有候选导入改为 shared-ui 快照；复制 Icon、WorkspaceHeader、tokens.css 及确实需要的输入，检查传递导入 |
| `apps/server/deploy/Dockerfile`、根 `.dockerignore` | 随私有端修复复制路径与上下文；公有端移除无用途的服务 Docker 上下文 |
| `package.json` | 删除 console:*、website:* 命令；build 不再编译 console-contracts；保留桌面工具与 updater 依赖 |
| `pnpm-workspace.yaml` | 去 apps/*、旧 packages/*；保留根包、overrides、Electron/esbuild 构建允许策略；清除仅服务端需要的 allowBuilds 项 |
| `pnpm-lock.yaml` | 以锁定工具链重新生成，去私有 importers 和仅由其引入的依赖；不顺带升级桌面依赖 |
| `tsconfig.json`、`eslint.config.mjs` | 校验全部公有源码/测试/配置，不以 exclude 掩盖残余私有导入 |
| `vitest.config.ts` | 去旧包 alias；默认测试不收集私有服务用例 |
| `playwright.config.ts` | 保留桌面测试与真实屏幕条件；移除不再存在的 console 特殊项 |
| `playwright.console.config.ts`、`tests/helpers/console-totp.ts`、`tests/integration/console.spec.ts` | 迁入私有端并修正路径 |
| `tests/unit/console-api.test.ts`、`console-campaigns.test.ts`、`console-decisions.test.ts`、`console-deployment.test.ts`、`console-grants.test.ts`、`console-security.test.ts`、`console-typesafe.test.ts` | 迁入私有端；TypeSafe 客户端安全断言已在 Phase 2 公有测试中保留；console-typesafe 的 autoActionRouter 断言迁回公有端，defaultPredictionBranches 改为私有 fixture，清除对桌面 src 的反向依赖 |
| `tests/helpers/desktop-account.ts` | 公有测试零消费者后移出；私有账号测试按需保留 |
| `scripts/console-e2e-server.mts`、`package-console-image.sh`、`test-console-image.mjs`、`benchmark-console-decisions.mjs` | 随服务私有迁移 |
| `scripts/package-website-image.sh`、`test-website-image.mjs` | 随官网私有迁移 |
| `docs/CONSOLE_*.md`、`docs/WEB_CONSOLE_*.md`、`docs/WEBSITE_*.md`、`docs/DESKTOP_ACCOUNT_AND_EMAIL.md`、相关截图及基准 | 按附录 C 精确清单迁移；混合客户端价值先拆出，不能按词盲删 |
| `.gitignore` | 继续忽略秘密、运行数据和产物；删除私有目录规则前确认新位置不暴露；不取消保护 |

目标依赖图中无需 Fastify、better-auth、better-sqlite3、nodemailer、qrcode.react 等私有工作区专用组件；是否有同名传递依赖以实际 lock 图为准，不手工删 node_modules 假装完成。

### 8.4 Phase 4：独立更新、打包与文档

| 文件 | 计划修改/保留 |
| --- | --- |
| `src/shared/release-source.json` | 保持独立 Release 仓库配置，不改为官网或账号 API |
| `src/main/updates/UpdateCheckService.ts` | 保留匿名版本检查；按 OS/架构匹配可安装资产，避免 Mac-only 版本误报 Windows 可更新 |
| `src/main/updates/ElectronUpdateInstaller.ts`、`UpdateInstaller.ts` | 保留 Mac 启用标记、Team 校验、ZIP 哈希/签名链、显式下载和重启；Windows 维持手动路径 |
| `src/shared/updates.ts`、`src/renderer/src/settings/UpdateSettings.tsx` | 保留状态与桥，UI 不再与账号/官网文案绑定 |
| `electron-builder.yml`、`electron-builder.macos-release.cjs`、`electron-builder.macos-validation.cjs`、`electron-builder.windows.yml` | 保留 appId、产品包名、资源、Helper、签名和独立输出；检查最终包不含私有端/账号模块 |
| `build/entitlements*.plist`、`scripts/build-native-helper.sh`、`scripts/dev-stable-app.sh`、`scripts/electron-launchservices-wrapper.sh` | 保持身份和权限稳定，Windows 启动文档明确使用可运行的入口 |
| `scripts/macos-release/common.cjs`、`hooks.cjs`、`preflight.cjs`、`release.cjs`、`verify.cjs`、`publish.cjs`、`update-metadata.cjs`、`test-update.cjs` | 保留严格验证；去“官网可分发”误导文字，增加源码 SHA/锁文件摘要；本次规划不执行任何发布器 |
| `scripts/package-release.sh`、`package-friend.sh`、`package-windows-friend.sh`、`package-windows.mjs`、`verify-windows-build.mjs`、`package.json` | 统一开发/内部/正式入口，处理旧 dist:release 与正式流程歧义，修复发布说明文件名 |
| `.github/workflows/windows-internal.yml`、`docs/ci/windows-release.yml`、`docs/ci/README.md` | 去账号测试列表，保留安装卸载与最小权限；后者是模板不能当作已运行 CI |
| `.github/workflows/ci.yml`（新） | 纯客户端 lint/typecheck/unit/build 与适合 runner 的合成冒烟；签名/发布独立 |
| `tests/unit/updates.test.ts`、`update-installer.test.ts`、`release-publication.test.ts` | 独立来源、无 Cookie、平台资产、版本/哈希/白名单测试 |
| `tests/integration/updates.spec.ts`、`windows-release.spec.ts` | 无账号、断网恢复、保留笔记、按当前平台升级/手动安装 |
| `README.md`、`AGENTS.md`、`docs/PRD.md`、`ROADMAP.md`、`TECHNICAL_DESIGN.md`、`PROJECT_STRUCTURE.md`、`UPDATE_CHECK.md`、`RELEASE_DISTRIBUTION.md`、安装指南 | 以新产品边界为准，区分历史记录和当前支持范围；开源许可/素材问题仍需单独关闭 |

## 9. 数据与配置迁移策略

### 9.1 保持现有身份和数据位置

不改 com.snipvia.desktop、Snipvia.app、正式 userData 规则和开发版隔离目录；不把“去账号”变成重新命名应用。升级签名 Team 与 safeStorage 应用身份保持兼容，避免 TCC、Keychain 和历史路径变化。

现有本地记录按设备 userData 和用户选定目录保存，并没有要求先按账号分区重排的依据。因此不新增“账号数据合并”或云端数据下载迁移。

| 数据 | 当前实现/位置 | 策略 |
| --- | --- | --- |
| 模型/分支/主题配置与 Key | storage/settings.ts；settings.json，包含 settings、profiles、encryptedKeys、appearance | 原样保留厂商 scope、各 profile、模型、分支和快捷键；不因默认预测策略变化覆盖用户配置 |
| 旧凭据格式 | credentials.json / credentials.key 的既有迁移 | 保留先成功写入再删除旧文件的安全顺序，不创建新明文回退 |
| 账号 Cookie | account/session.json | 新版不读、不解密、不联网注销；初期留作本地回滚兼容，不把其存在当成登录状态；遗留目录继续被 Agent 保护 |
| 对话与截图 | history/conversations.json、history/captures | id、时间、模型、旧截图/文本会话与重生成历史继续读取 |
| 消息图片 | history/attachments | 保留关联、删除与孤儿清理，不把原图再上传作迁移 |
| 日程 | schedule/jobs.json 及关联截图 | 保留草稿/确认/系统写入状态；不自动再次提取或写入日历 |
| 笔记 | notebooks.json + 用户授权目录 | 保留链接与原文件；不能把取消链接当作删除，也不迁入源码 |
| Agent | agent-sessions、agent-checkpoints、agent-permissions、mcp | 保留上下文/撤销与权限范围；旧 account 路径保护继续保留 |
| 模型目录 | ModelCatalog 持久缓存 | 可按既有缓存版本策略失效，不删除用户模型或 Key |
| 服务端数据库/密钥 | .console-data、私有部署 config/data/backups 等 | 不导入客户端、不提交到任何新仓库；由私有运维交接处理 |

### 9.2 可选 Jev 独立配置

建议新增 userData/prediction-settings.json，使用 version:1；它不属于某一个对话模型 profile，避免用户切换厂商后把 Jev Key 覆盖或误复用。

~~~json
{
  "version": 1,
  "typeSafe": {
    "enabled": false,
    "model": "jev-1.13.0",
    "encryptedKey": null
  },
  "timeoutMs": 30000
}
~~~

以上是拟定存储结构，model 默认参考本地现有配置，实际可用性未联网核实，不应作为永久模型承诺。encryptedKey 只保存 safeStorage 密文；公共视图返回 enabled/model/hasKey/timeoutMs，不能返回密文或原文。

- 缺失新文件时默认 LLM，不能令旧配置加载失败。
- 用户明确启用并填写 Key 后才调用 Jev；关闭或删除 Key 后新请求自动回到 LLM。
- 新配置写入采用临时文件、原子替换和最小文件权限；存储不可用拒绝持久保存，不写明文。
- 无 Key 与“配置损坏/无法解密”分开处理；后者显示错误且不静默上传。
- 不读取服务端 .env 的 TYPESAFE_API_KEY，不尝试解密服务端数据库。服务端根秘密加密的 Key 不具有可直接迁移性，用户重新配置自己的 Key。
- 旧版不会认识独立新文件，因此回滚时无需回写旧 settings。所有自动迁移必须可重复且失败保留原件。
- 任何备份仅保存在受控本机位置，不进入 Git、测试产物、Release 或私有源码归档。

### 9.3 环境变量处置

| 分类 | 变量 | 处理 |
| --- | --- | --- |
| 删除客户端账号来源 | MAIN_VITE_CONSOLE_ORIGIN、SNIPVIA_CONSOLE_ORIGIN | 不再读取，编译产物不含默认官方域名/官方账号路由 |
| 私有服务/部署 | CONSOLE_*、CONSOLE_SECRET/_FILE、SMTP_URL/_FILE、MAIL_FROM、OPENAI_DECISIONS_ENDPOINT、服务端 OPENAI_API_KEY/_FILE、TYPESAFE_API_KEY/_FILE、TYPESAFE_MODEL、DECISIONS_*、APP_IMAGE、CADDY_IMAGE、WEBSITE_* 等 | 随私有服务文档与脚本迁出；不能再作为客户端运行前提 |
| 保留用户搜索配置 | SNIPVIA_BRAVE_SEARCH_API_KEY、SNIPVIA_EXA_SEARCH_API_KEY、SNIPVIA_WEB_SEARCH_PROVIDER | Main 使用；不作为登录凭据；实际调用与第三方收件方仍需隐私说明 |
| 保留开发/测试/性能 | ELECTRON_RENDERER_URL、SNIPVIA_CAPTURE_*、SNIPVIA_SCK_*、SNIPVIA_PERF、SNIPVIA_REAL_SCREEN、SNIPVIA_DEV_*、SNIPVIA_AGENT_DEBUG 等 | 按现有 packaged 限制保留，不为测试开启生产绕过 |
| 保留官方签名/公证 | SNIPVIA_SIGNING_*、SNIPVIA_NOTARY_*、SNIPVIA_RELEASE_*、APPLE_KEYCHAIN_PROFILE、APPLE_KEYCHAIN、DEVELOPER_DIR、CSC_IDENTITY_AUTO_DISCOVERY 等 | 维护者发行环境使用，不打包到客户端，不要求普通贡献者持有 |

本轮只记录本地 apps/server/.env 的键名及其被忽略状态，没有把任何值写入文档。本机进程存在 MOONSHOT_API_KEY，也不能自动变成应用默认凭据或新 Jev 配置。

## 10. 关闭官网后的更新与旧客户端安排

### 10.1 从代码可确认的独立性

- UpdateCheckService 从 release-source.json 构造 https://api.github.com/repos/yuyeyuyy/Snipvia-releases/releases/latest。
- 请求使用 credentials:omit，没有 AccountService、账号 Cookie 或官网来源。
- 正式 Mac 配置与 ElectronUpdateInstaller 使用同一 Release 仓库的 generic 资产地址；下载固定到用户选定的 tag。
- Mac 更新还依赖已打包、snipviaAutoUpdate:true、既有签名 Team、有效更新清单和 ZIP；独立于账号。
- 用户确认重启前仍会检查活动任务、flush 笔记并等待文件空闲。
- Windows 当前不具备签名自动安装，只能检查版本并打开发布页手动更新。

结论：关闭 server/console/website 不会直接破坏这些代码路径，但 GitHub 仓库、资产和签名链必须继续可用。独立渠道“现在在线可用”未在本轮远程验证。

### 10.2 必须维持的发行约束

1. 保持现有独立 Release 仓库及旧 tag，不把源仓迁移误做分发仓迁移。
2. 在版本检查中按平台与架构筛选资产；当前 releaseSchema 不读 assets，平台版本不同步时会误报。
3. 保留 SHA-512、签名校验、禁止降级、普通退出不自动安装和显式用户确认。
4. 社区构建继续可以手动更新；不要给任意 fork 开启官方签名更新能力。
5. 新免费版使用高于旧版的未使用版本号，保持 appId 与数据位置，旧数据继续可读。
6. 发布说明、迁移指南和下载入口放在 Release/公有仓库 README，不依赖即将关闭的官网。
7. 旧版本若仍要求账号，在服务器关闭后可能不能使用 AI；新版发布并完成可获取验证之后才执行最终停服。
8. 早期未接入公开源或未启用签名更新的旧包需手动安装；不能承诺所有历史版本都能自动跨越迁移。

## 11. 分阶段顺序与验收标准

所有阶段均需逐阶段确认；本文件不是对后续远程、签名或停服操作的执行授权。下面命令只是未来验收入口，本轮未运行。

### Phase 1：建立无账号客户端与直接大模型预测闭环

实施顺序：

1. 对当前 tracked 修改和 untracked 功能建立可恢复本地基线，记录数据夹具与核心行为。
2. 新建纯桌面测试 helper，并先建立“没有账号服务也能工作”的反向网络断言。
3. 将客户端错误契约本地化，接入 LLM 默认预测；移除 classifyWithServer 与 OCR 替代默认分类的捷径。
4. 按 3.3 逐项去 Main 会员检查和账号驱动取消，保留所有安全检查。
5. 删除客户端账号 IPC/API/UI；不更名应用，不迁出 apps 或整个契约包。
6. 更新 32 个 helper 消费者与混合测试，替换旧资格预期，保留可见窗口、取消和错误恢复的回归。
7. 同步本阶段产品、UI 与开发文档。

验收标准：

- 干净临时 userData 下，无登录/注册/会员入口和 account 桥；旧 account IPC 不再可调用。
- 将旧官方域名、旧 /api/auth /api/me /api/predictions 路由列为禁止目标，启动、截图、对话、Agent、应用提案全程没有请求或 Cookie。
- 人为设置旧 CONSOLE 来源变量、放入过期/损坏 Cookie，不改变行为、不触发解密或联网。
- 不配模型也能打开、截图编辑/复制/保存、使用本地笔记与历史；AI 触发时可见配置提示且不发未认证请求。
- 配置合成视觉模型、不配 Jev，空输入 Enter 能根据启用条件选择分支；自定义排除条件和顺序仍有效。
- 未匹配、低置信度、坏 JSON、停用/不存在分支、网络失败和取消不产生自动写入。
- 主窗口对话、截图问答、导入/续拍、Agent 笔记提案及确认保存无需账号；文件/系统权限仍会生效。
- 临时数据与合成图片下运行 lint、typecheck、test、build 和相关 Electron 冒烟；条件跳过列明原因，不能计为平台通过。
- 阶段交付只实现这一闭环，不自动进入 Phase 2，也不分仓、签名、发布或停服。

回滚：仅回退本阶段新增补丁到已保存的工作区基线，不能回退到旧 HEAD 丢失现有功能。旧用户数据不被破坏；未部署任何服务变动。

### Phase 2：可选 Jev、配置持久化与隐私一致性

实施顺序：

1. 提取 TypeSafe 外部协议和分支映射，不提取服务用户、配额与数据库结构。
2. 建立可取消、有界直连客户端及用户视觉描述适配。
3. 加入独立加密配置、窄 IPC 和设置分组。
4. 测试重启、清除 Key、切换模型与错误重试；同步隐私和模型费用说明。

验收标准：

- 无 Key、关闭 Jev、删除 Key 后均自动使用用户视觉模型。
- 有 Key 且启用时图片只发用户视觉服务，文字/条件只发 TypeSafe，两个 Key 不交叉。
- Jev 请求/响应遵循本地已知协议；问题名/类型、概率和分支索引异常均拒绝，model 一致性校验通过。
- 分支列表为空时零请求；两条路径均不依赖官方服务。
- 错 Key、限流、超时、断网、半截 JSON、超大响应、用户取消时资源释放，错误脱敏，不能自动重复收费。
- 请求中修改模型/规则/Key，旧响应不执行新配置下的动作；用户停止后没有迟到日程/笔记写入。
- 保存/清除/重启时 Key 不出现在 Renderer 返回值、历史、日志、命令环境或测试产物。
- 从旧 userData 升级后模型配置、分支 id、笔记绑定、主题、快捷键、历史、图片和检查点仍可用。
- TypeSafe 真实网络兼容性与费用验证需要用户后续明确批准；未做时标记未验证，不用 mock 结果代替。

回滚：禁用新 Jev 设置，仍可使用 Phase 1 的默认 LLM；独立新文件不要求旧版能解析，不回滚用户笔记内容。

### Phase 3：构建解耦与公私候选准备

实施顺序：

1. 从基线建立完整私有归档候选，覆盖未跟踪服务/官网成果及测试文档。
2. 修复私有端 UI 快照、服务测试分支 fixture 与 Docker 输入，确认归档可单独类型检查/构建；不因此重新部署。
3. 在公有候选排除旧 apps、console-contracts、服务测试/脚本/资料，清理根命令和 workspace。
4. 用固定工具链更新 lockfile，核对公有依赖来源；不升级无关桌面库。
5. 形成明确公有快照/私有历史策略，仍不创建远程仓库或变更权限。

验收标准：

- 将私有目录从公有候选物理拿走后，fresh install --frozen-lockfile、lint、typecheck、test、build 和桌面烟测可完成。
- 公有源码、测试、配置和脚本没有对 apps/server、apps/console、apps/website、console-contracts 的导入/复制/执行引用；历史说明仅允许明确的文档记录。
- 默认 test 不启动 Fastify，不创建用户、资格或服务 SQLite。
- 无效私有模块路径不能通过 alias、node_modules 残留或已生成 dist 被掩盖；在干净隔离副本验证。
- 私有候选文件清单、摘要和未提交成果核对完整；环境文件与数据库作为敏感运维资产单独交接，不入 Git。
- 公有源码和打包包体不含旧账号域名/账号路由及私有服务源码；纯产品历史文档中的引用需明确标注。
- 完整旧 Git 历史继续私有；公有候选历史范围经过确认，不能以目录已删除推断历史已清除。

回滚：保留两端候选和清单，恢复本地工作区/构建配置补丁；不触碰远程历史或旧 Release。

### Phase 4：独立更新与跨平台发行准备

实施顺序：

1. 保留独立来源、完善平台资产筛选，统一开发/内部/正式打包入口。
2. 校验无账号源码在实际包中的行为及数据兼容，建立纯客户端 CI 文件。
3. 完成支持平台的本地构建与合成安装检查；排定真机及真实更新验证。
4. 产出可审查的变更、发布说明、待执行签名/发布计划；实际执行需要另行批准。

验收标准：

- 旧官方域名和官网全部不可达时，模拟 GitHub 仍可检查版本、展示说明、选择匹配平台的更新。
- 更新不读取账号 Cookie、不要求任何模型 Key，离线/404/限流不阻断本地功能。
- Mac 签名链、哈希、显式确认、笔记 flush、取消/失败恢复和 appId 保持；验证构建不误触签名/公证。
- Windows 构建通过专用入口，不要求 Swift；当前未签名自动更新边界明确，安装卸载保留用户数据。
- macOS arm64、Intel 和 Windows 的真实截图、权限、混合 DPI、显示器变化和热键结果分别记录；未执行的平台继续标实验性。
- 合成测试不能替代真实模型、真实 TCC 或安装位置升级验证。
- 原开源审计中的许可证、素材授权和第三方声明仍须关闭，重构完成不自动等于可公开。

回滚：发布前只回退候选补丁；若未来已发布，修复用更高版本，不覆盖旧 tag 或降低更新签名校验。不用自动降级覆盖新数据。

### Phase 5：经单独批准的私有迁移与停止部署

此阶段包含远程与运维操作，本轮不执行，Phase 1 的确认也不自动授权。

实施顺序：

1. 先核对私有归档、受控备份、恢复清单和源码/文档授权范围。
2. 按维护者确认的策略建立公有客户端与私有归档远程；Release 仓库不迁移。
3. 在独立渠道提供无账号新版及旧版升级说明，验证用户可获取。
4. 停止 server/console/website 的应用和自动部署、后台任务及相关 webhook；只处理明确属于这些服务的资源。
5. 根据保留策略撤销不再需要的模型/SMTP/镜像部署凭据，停服数据加密归档；不删除用户本地文件。
6. 保留域名/证书等共享资源的清单，不能因官网停服误拆其他服务或独立 Release。

验收标准：

- 无账号新版可从独立渠道取得；旧版必须手动更新的情况有明确指引。
- 私有代码/配置交接完整，数据库恢复验证完成，真实秘密不进入任何源码仓库。
- 服务不再运行或自动重建，相关自动部署已停止；所有结果由运维证据确认，不能只看本地脚本。
- GitHub Release 及更新资产持续可用，不依赖被停服务。
- 停服不阻断新客户端本地功能与用户直连模型。

回滚：只在维护者另行批准且备份可恢复时恢复旧服务；不是客户端回滚的前提。已经公开的源码无法通过改权限可靠收回，因此公开前必须完成许可、素材、历史和秘密检查。

## 12. 主要风险与控制

| 风险 | 后果 | 控制/验收 |
| --- | --- | --- |
| 把去账号当作删 UI | Main 继续拒绝调用或后台仍联网 | 3.3 清单 + 无官方请求测试 |
| 只保留 HEAD | 丢失工作区对话、图片、模型、更新等功能 | 含 untracked 的恢复基线 + 附录 A 核对 |
| 删除 apps 后才发现测试耦合 | tsc/Vitest/打包不可运行 | 先换 32 个 helper 消费者与混合用例，再分仓 |
| OCR 错路由替代 LLM | 不符合新决策，条件编辑失效 | 默认路径必走视觉大模型；坏响应等待手动 |
| Jev 被当作视觉模型 | Windows 或非文本截图错误 | 明确视觉描述 -> 文字 Jev，两 Key 隔离 |
| 失败后静默多厂商回退 | 重复收费/重复上传 | 无 Key 自动选择与失败显式重试分离 |
| 去会员误删安全确认 | Agent 写文件/命令能力扩大 | sender、路径、diff、沙箱、权限拒绝测试保留 |
| 改应用身份/凭据格式 | TCC 重授、Key 无法解密、数据失联 | appId/签名 Team/userData 不变，单独 Jev 文件 |
| 删除账号目录解除敏感路径保护 | 旧 Cookie 可能被工作区读取 | 旧路径继续列为受保护目录 |
| 停服早于新版可获取 | 旧用户 AI 中断 | 免费版可获取与迁移说明先行 |
| 官网迁出误删 updater | 用户无法发现新版 | 独立 Release 配置与 updater 保留测试 |
| 只删除 tree 就公开 Git | 历史私有服务仍全部公开 | 私有旧历史 + 审查后的公有快照，或另批历史方案 |
| Windows 被当作 Mac 等价 | 开放不安全命令或过度承诺 | Windows 沙箱继续禁用，真实平台结果单列 |
| 仅凭本轮静态审计声称通过 | 误导实施/发布决策 | 本文件所有阶段验收均保持未执行状态 |

## 13. 规划阶段交付与停止条件

本阶段交付仅为本文件。未修改业务代码、配置、锁文件、测试或 Git 历史；未迁移仓库或运行数据，也未停止任何服务。

下一步仅在维护者明确确认后执行 Phase 1。Phase 1 不包含可选 Jev 的全部实现、私有仓库远程迁移、源码公开、签名、公证、正式发布或线上停服。

## 附录 A：本轮识别的关键未跟踪桌面文件

以下为按当前功能范围提取的具体文件，不是全部 421 个未跟踪文件。关联测试、文档、截图、release entitlements 和 scripts/macos-release 也必须纳入基线，不能只保存这份清单。

- `.github/workflows/windows-internal.yml`
- `electron-builder.macos-release.cjs`
- `electron-builder.macos-validation.cjs`
- `electron-builder.windows.yml`
- `scripts/package-windows.mjs`
- `scripts/verify-windows-build.mjs`
- `src/main/agent/editing/EditingProposals.ts`
- `src/main/agent/editing/branches.ts`
- `src/main/agent/editing/registerEditingTools.ts`
- `src/main/ai/models/ModelCatalog.ts`
- `src/main/ai/models/adapters.ts`
- `src/main/ai/models/catalogue-mapping.ts`
- `src/main/ai/models/http.ts`
- `src/main/ai/models/vision-test.ts`
- `src/main/chat/ChatImages.ts`
- `src/main/chat/image-validation.ts`
- `src/main/chat/provider-images.ts`
- `src/main/storage/chat-images.ts`
- `src/main/updates/ElectronUpdateInstaller.ts`
- `src/main/updates/UpdateCheckService.ts`
- `src/main/updates/UpdateInstaller.ts`
- `src/renderer/src/chat/ChatComposer.tsx`
- `src/renderer/src/chat/ChatMessages.tsx`
- `src/renderer/src/chat/ChatSidebar.tsx`
- `src/renderer/src/chat/ChatWorkspace.tsx`
- `src/renderer/src/chat/EditingPanel.tsx`
- `src/renderer/src/chat/ImageAttachments.tsx`
- `src/renderer/src/chat/editing.css`
- `src/renderer/src/chat/image-attachments.css`
- `src/renderer/src/chat/model-choice.ts`
- `src/renderer/src/chat/quick-chat.css`
- `src/renderer/src/chat/sidebar.css`
- `src/renderer/src/chat/useChatScroll.ts`
- `src/renderer/src/chat/useConversationModel.ts`
- `src/renderer/src/chat/workspace.css`
- `src/renderer/src/components/AppShell.tsx`
- `src/renderer/src/components/ui/Button.tsx`
- `src/renderer/src/components/ui/Dialog.tsx`
- `src/renderer/src/components/ui/EmptyState.tsx`
- `src/renderer/src/components/ui/LoadingState.tsx`
- `src/renderer/src/design/app-shell.css`
- `src/renderer/src/design/controls.css`
- `src/renderer/src/design/tokens.css`
- `src/renderer/src/settings/AppearanceSettings.tsx`
- `src/renderer/src/settings/ModelSelectRow.tsx`
- `src/renderer/src/settings/UpdateSettings.tsx`
- `src/shared/agent/editing.ts`
- `src/shared/chat-images.ts`
- `src/shared/history.ts`
- `src/shared/models.ts`
- `src/shared/release-source.json`
- `src/shared/updates.ts`

## 附录 B：引用账号 helper 的全部 32 个桌面集成测试文件

每个文件都要迁移 helper 或重写相关用例。保留对话、窗口、权限、文件和性能断言；仅归档账号行为，不降低桌面回归覆盖。

- `tests/integration/agent-commands.spec.ts`
- `tests/integration/agent-execution.spec.ts`
- `tests/integration/agent-file-approval.spec.ts`
- `tests/integration/agent-note-writing.spec.ts`
- `tests/integration/agent-notebooks.spec.ts`
- `tests/integration/appearance.spec.ts`
- `tests/integration/capture-account-latency.spec.ts`
- `tests/integration/capture-early-selection.spec.ts`
- `tests/integration/capture-latency-real.spec.ts`
- `tests/integration/capture-performance-phase3.spec.ts`
- `tests/integration/capture-performance-phase4.spec.ts`
- `tests/integration/capture-performance-phase5.spec.ts`
- `tests/integration/capture-performance-phase6.spec.ts`
- `tests/integration/capture-window-visibility.spec.ts`
- `tests/integration/chat-images.spec.ts`
- `tests/integration/chat-redesign.spec.ts`
- `tests/integration/chat-workspace.spec.ts`
- `tests/integration/desktop.spec.ts`
- `tests/integration/editing-workspace.spec.ts`
- `tests/integration/monochrome.spec.ts`
- `tests/integration/notes-navigation.spec.ts`
- `tests/integration/notes-preferences.spec.ts`
- `tests/integration/performance.spec.ts`
- `tests/integration/prediction-criteria.spec.ts`
- `tests/integration/prediction-errors.spec.ts`
- `tests/integration/provider-settings.spec.ts`
- `tests/integration/quick-chat-workspace.spec.ts`
- `tests/integration/screenshot-editor.spec.ts`
- `tests/integration/screenshot-membership.spec.ts`
- `tests/integration/visual-acceptance.spec.ts`
- `tests/integration/windows-capture-ui.spec.ts`
- `tests/integration/workspace-browsing.spec.ts`

## 附录 C：私有迁移资料与混合内容

### C.1 确定随私有端迁移的测试/配置

- `playwright.console.config.ts`
- `tests/helpers/console-totp.ts`
- `tests/integration/console.spec.ts`
- `tests/unit/console-api.test.ts`
- `tests/unit/console-campaigns.test.ts`
- `tests/unit/console-decisions.test.ts`
- `tests/unit/console-deployment.test.ts`
- `tests/unit/console-grants.test.ts`
- `tests/unit/console-security.test.ts`
- `tests/unit/console-typesafe.test.ts`

另外包括账号模块退出公有运行链后的旧账号测试和 helper 基线。console-typesafe.test.ts 中能复用的协议/取消/错误用例先提取到新客户端测试。

### C.2 服务端与官网专用文档

- `docs/CONSOLE_0_2_1_RELEASE.md`
- `docs/CONSOLE_CAMPAIGNS.md`
- `docs/CONSOLE_DOCKER_DEPLOYMENT.md`
- `docs/CONSOLE_GRANT_MANAGEMENT.md`
- `docs/CONSOLE_PREDICTION_PROXY.md`
- `docs/CONSOLE_TEST_CASES.md`
- `docs/CONSOLE_VISUAL_ALIGNMENT.md`
- `docs/WEB_CONSOLE_DEVELOPMENT.md`
- `docs/WEB_CONSOLE_PLAN.md`
- `docs/WEBSITE_DOCKER_DEPLOYMENT.md`
- `docs/WEBSITE_ROUND_2_VALIDATION.md`
- `docs/WEBSITE_ROUND_3_VALIDATION.md`
- `docs/WEBSITE_VALIDATION.md`
- `docs/WEBSITE_VISUAL_SYSTEM.md`
- `docs/DESKTOP_ACCOUNT_AND_EMAIL.md`
- `docs/benchmarks/console-prediction-20261005.json`
- `docs/ci/website-image-2026-10-12.json`
- `docs/ui/web-console-*.png`、`docs/ui/console-monochrome/`、`docs/ui/website/`、`docs/ui/website-round2/`、`docs/ui/website-round3/` 以及旧账号登录/资料截图，按实际文件清单核对迁移。

### C.3 需要保留客户端部分、不能整体迁走的资料

- README、PRD、TECHNICAL_DESIGN、PROJECT_STRUCTURE、UI_DESIGN_LANGUAGE、ROADMAP：重写当前边界，移出私有运维章节，不抹去未完成平台限制。
- AUTO_SCREENSHOT_UNDERSTANDING、DESKTOP_MODEL_PROVIDERS、MODEL_DISCOVERY：保留分支语义、厂商适配和能力依据，删除官方账号路径并补可选 Jev。
- AI_NOTES、AI_CHAT_WORKSPACE_PHASE1–4、AI_CHAT_UI_REDESIGN、AGENT_*：保留本地能力与确认/权限设计，旧会员内容标为历史。
- MACOS_RELEASE*、MACOS_UPDATE_TEST、UPDATE_CHECK、RELEASE_DISTRIBUTION、WINDOWS_BUILD_REPORT、docs/ci 中真实桌面发行证据：留作客户端历史与兼容依据；区分旧账号版和新免费版，不随官网归档。
- docs/ui 中客户端主题、聊天、图片、笔记、模型、截图、更新验收素材：保留并复核隐私与授权；不能按“服务器”或“account”单词批量删除。
