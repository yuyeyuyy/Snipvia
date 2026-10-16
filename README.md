# Snipvia（截然）

**Snip. Ask. Act.**

面向 macOS 和 Windows 的截图 AI 助手：快捷键框选屏幕，在截图旁提问、解释代码和错误，或把图片中的安排整理成待确认日程。桌面核心完全免费、本地优先、无需登录；用户自行配置模型与 API Key。项目保留本地 Markdown 笔记和 Agent 工具调用。

## 当前状态

文档更新：2026-10-16。当前为独立 Electron 桌面工程，Phase 1 已移除官方账号和会员限制，预测直接使用用户视觉模型。服务端、控制台和官网已迁至私有仓库 `yuyeyuyy/Snipvia-server`。[Phase 1 实施报告](docs/opensource/PHASE1_REPORT.md) 记录验证、数据兼容与剩余发布门槛。旧混合历史保留在私有归档 `Snipvia-legacy`；当前同名 `Snipvia` 是独立客户端历史的新私有仓库，见[仓库历史隔离报告](docs/opensource/REPOSITORY_ISOLATION_REPORT.md)。许可证和素材授权待确认，尚未公开或发布新的免费安装包。

Mac 桌面应用 **v0.2.3** 的变更见 [发布说明](docs/RELEASE_NOTES_0_2_3.md)，签名、公证与验证见[发布报告](docs/MACOS_RELEASE_0_2_3.md)，安装包从独立公开的 [GitHub Release](https://github.com/yuyeyuyy/Snipvia-releases/releases/tag/v0.2.3) 下载。v0.2.2 可直接通过应用内下载并确认重启更新；v0.2.1 或更早版本需先手动安装新版 DMG。Windows 沿用 v0.2.1 预览版。源码仓库保持私有，分发机制见[迁移说明](docs/RELEASE_DISTRIBUTION.md)。下表描述本版源码与已知边界。私有系统已独立保存，见[分离报告](docs/opensource/SEPARATION_REPORT.md)。

| 模块 | 当前源码已实现 | 边界 |
| --- | --- | --- |
| 截图与对话 | 快捷键框选、置顶图片、截图旁流式对话、续拍追问、本地历史 | 只上传选中区域；普通截图支持标注，长截图未实现 |
| 截图预测 | 四个内置分支：解释错误、解释代码、回答问题、创建日程草稿；名称、适用内容、执行指令和笔记本绑定可编辑 | 空输入按 Enter 才触发；低置信度、无命中或调用失败时等待手动操作 |
| AI 笔记 | 本地 Markdown、三种编辑模式、代码高亮与复制、GFM 表格、标题大纲、双向链接、附件、ZIP 导出、文件拖拽、侧栏连续收起 | 移除笔记本只取消链接；Agent 可提出新建、追加与局部编辑建议，每次查看差异并确认后保存；实际修改可撤销，之后被改过的笔记不覆盖；附件自动写入未实现 |
| AI 对话工作区 | 居中欢迎页、分组会话侧栏、重命名与模型恢复；流式输出、停止、重新生成；授权笔记 / 预测规则与确认编辑；本地图片选择、⌘V 粘贴、拖放、已有截图、消息图片预览与历史恢复 | 模型只能提出结构化修改，没有直接写文件或命令权限；图片能力不足会明确提示；详见 [Phase 3](docs/AI_CHAT_WORKSPACE_PHASE3.md)与 [Phase 4](docs/AI_CHAT_WORKSPACE_PHASE4.md)；最新源码界面见 [UI 重构](docs/AI_CHAT_UI_REDESIGN.md) |
| Agent | 图像问答、联网搜索、网页分块阅读、授权工作区检索、自动整理笔记、沙箱命令与 JavaScript / Python / Shell 脚本、计划清单、步骤时间线、来源展示、停止任务；会话跨重启保留，长对话自动摘要压缩 | 脚本及非只读命令需确认；命令限当前笔记本，macOS 已验证，Windows 暂不开放；通用文件修改和外部 MCP 执行未开放 |

macOS 是优先验证平台，提供 macOS 14+ Apple 芯片与 Intel 的独立安装包；Intel 真机兼容性仍需完整验收。Windows 使用 Electron 截图适配，Windows 11 x64 的安装、自启、混合 DPI 和完整流程仍需真机验收。

桌面历史、日程和笔记使用本地文件，开发和运行不需要后台或数据库服务。客户端已接入启动后台版本检查和「设置 → 关于 → 检查更新」，显示 GitHub Release 版本号与 Markdown 更新说明。启用更新的正式签名 Mac 版支持用户点击下载、保存笔记后「重启并更新」；开发版、旧安装包及当前未签名 Windows 版通过发布页手动更新。详见[版本检查与更新](docs/UPDATE_CHECK.md)。应用内定时提醒、ICS、双向日历同步和笔记云同步尚未实现。Mac 日历及提醒事项写入需要用户核对并确认。

2026-10-12 Mac 更新实机测试：独立签名测试包从 0.2.1 自行升级并重启到 0.2.2，笔记与签名检查通过；迁移前的私有仓库匿名更新源返回 404，当时尚未完成线上分发验收，详见[测试报告](docs/MACOS_UPDATE_TEST.md)。

同日分发迁移后：源码保持私有，`Snipvia-releases` 已公开发布原 v0.2.1；真实匿名客户端版本检查和公开资产校验通过。更新与正式发布改用统一公开仓库配置，旧包仍需手动升级，详见[分发迁移记录](docs/RELEASE_DISTRIBUTION.md)。

UI 2.0 阶段 2 已在源码实现：Light / Dark / System（默认跟随系统）、跨窗口主题同步、176px / 52px 可折叠导航和快捷导航。阶段 2.5 将客户端视觉统一为黑白灰 Monochrome，保留截图与标注内容原色。通过「设置 → 外观」切换，重启后保留选择。这些界面改造现随 v0.2.2 Mac 安装包分发。见 [阶段 2 实施记录](docs/UI_2_0_STAGE_2.md)与 [Monochrome Token、验证与截图](docs/UI_2_0_MONOCHROME.md)。阶段 3 已接入月历日期详情与历史同屏只读预览，见 [页面重构与验证](docs/UI_2_0_STAGE_3.md)。阶段 4 已实现 AI 笔记的居中编辑表面、按需大纲与紧凑分组设置，文件与模型业务保持，见 [实施清单、验证与亮暗截图](docs/UI_2_0_STAGE_4.md)。阶段 5 已接入截图 AI 紧凑浮窗与可调整双栏工作台，见 [截图、性能对比及验证范围](docs/UI_2_0_STAGE_5.md)。阶段 6 已完成桌面 Monochrome 审查并修复编辑器搜索样式，见 [全局验收、实际截图与实机检查边界](docs/UI_2_0_STAGE_6.md)。

## 开始开发

### 环境要求

- Node.js **24.15.x**（见 [.node-version](.node-version)）。
- pnpm **11.1.3**；依赖版本以 `pnpm-lock.yaml` 为准。
- Electron 窗口测试需要桌面会话；构建 macOS 原生截图辅助程序及安装包需要完整 Xcode。

在项目根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm electron:install
```

`pnpm electron:install` 下载当前架构的 Electron；若安装依赖时已完成下载，会复用已有运行时。

### 启动桌面应用

```sh
pnpm dev
```

开发模式使用固定的 `~/Applications/截然 Dev.app` 和独立数据目录 `~/Library/Application Support/snipvia-dev`，可以与已打包的 Snipvia 同时运行。源码修改会热更新开发版，已安装应用需要重新打包。

首次录屏授权可从「模型与设置 → 录屏权限」打开系统设置和 Finder，把选中的开发应用拖入录屏列表并启用，再重新运行 `pnpm dev`。普通源码修改不会替换该应用；Electron 版本变化时启动器会停止并提示处理。打包版拥有独立的应用身份，需要单独授权。详情见 [macOS 开发与验收](docs/DEVELOPMENT.md)。

### 免费、本地优先与模型配置

客户端无需注册、登录、资格或官方 Cookie。首次启动可直接截图编辑、保存、使用笔记与历史；AI 功能需要在「模型与设置」选择支持图片的模型并配置自己的 Key。自定义本地服务可不使用 Key。模型厂商可能收取 API 费用。

空输入 Enter 显式触发分支预测，直接把选中裁剪图和已启用分支的适用条件发给用户模型；没有匹配或预测失败时等待手动操作。可选 Jev 属于后续 Phase 2，本阶段不调用 Jev 或旧预测代理。

旧 `account/session.json` 保留原位但不读取、不解密；旧账号环境变量无效。私有系统迁移见[分离报告](docs/opensource/SEPARATION_REPORT.md)。

## 主要命令

以下命令均在项目根目录执行。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动固定开发应用和热更新 |
| `pnpm dev:prepare` | 准备或检查固定开发应用 |
| `pnpm dev:raw` | 直接通过 Electron 启动，用于运行时排查 |
| `pnpm icons:build` | 在 Mac 更新图标后，导出 PNG、ICNS、系统分层资源及菜单栏图标（需要 Xcode 26+） |
| `pnpm icons:tray` | 从 SVG 重新生成 Mac 黑白菜单栏图标及 Retina 版本 |
| `pnpm lint` | 全仓库 ESLint 检查 |
| `pnpm typecheck` | 桌面源码严格 TypeScript 检查 |
| `pnpm test` | 全仓库 Vitest 单元测试 |
| `pnpm test:smoke` | 构建并运行 Electron 集成测试；包含窗口、IPC 和功能验收 |
| `pnpm build` / `pnpm start` | 编译桌面应用到 `out/` / 启动构建产物 |
| `pnpm package` | 生成当前系统和架构的应用目录 |
| `pnpm dist` | 生成桌面安装包 |

桌面自动测试使用纯桌面 helper、模拟模型和合成截图；不需要服务端源码、生产账号或真实模型 Key。后端认证、限额、邮件和数据库测试保存在私有工程。真实录屏权限、混合 DPI 和跨平台验收仍需真机验证。

## 使用流程

### 截图、预测与 Agent

客户端预设支持 OpenAI、Anthropic Claude、Gemini、xAI Grok、百炼 Qwen、DeepSeek、智谱 GLM、Kimi、火山方舟 Doubao与自定义服务。刷新按钮位于模型下拉框左侧，动态查询 / 官方清单回退直接更新下拉选项，只展示已确认支持图片理解的模型；保留 24 小时缓存及手动 ID。OpenAI 预设更新为 GPT-6.1 Sol / GPT-6 系列，旧配置保持原模型；百度、腾讯、硅基流动和 OpenRouter 的入口已移除，已有配置以自定义服务展示并保留原凭据；详见[模型目录与能力识别](docs/MODEL_DISCOVERY.md)。千问、Kimi 和智谱可选择接口来源，凭据按来源独立保存；DeepSeek 预设使用支持图片的 `deepseek-flash`。配置、模型限制及验证范围见 [客户端模型厂商](docs/DESKTOP_MODEL_PROVIDERS.md)。

1. 在标题栏打开「模型与设置」，选择支持图片的对话模型并配置自己的 Key。桌面对话使用 Chat Completions 兼容协议，Agent 还需要 Tool Calling。分支预测也使用这一用户模型；不需要官方服务或 Jev Key。
2. 使用默认 `⌘⇧Space`（Windows：`Ctrl+Shift+Space`）框选；没有录屏权限时可通过主窗口导入图片。置顶截图可拖动，关闭图片会结束当前流程。
3. 截图后等待输入。空输入按 Enter 会预测分支；输入提示词后按 Enter 直接对话。默认 `⌘⇧Enter` 续拍并沿用最近对话上下文，跳过预测。
4. 无需账号即可使用截图对话、主窗口对话和 Agent。分支条件、置信度和日程信号仍须通过校验；失败显示模型设置提示，可明确重试。
5. Agent 可以搜索网页、读取相关段落和检索已授权工作区，回答下方提供来源入口。当前默认搜索为 Exa，配置 Brave Key 时优先使用 Brave，也可显式选择 DuckDuckGo；配置与实现见[联网研究说明](docs/AGENT_WEB_RESEARCH.md)。
6. 运行中可停止，悬浮对话可返回主窗口继续；历史保存在本机。识别出的日程先成为草稿，核对后才能保存为正式事项或添加到 Mac 日历、提醒事项。

普通截图默认使用 `⌘⇧A`（Windows：`Ctrl+Shift+A`），提供矩形、椭圆、箭头、画笔、文字、序号、打码及撤销重做，可复制、保存 PNG 或定住。点击「问 AI」才进入智能流程。三个截图快捷键都可在设置中修改，见[截图标注说明](docs/SCREENSHOT_EDITOR.md)。

### AI 笔记

主窗口默认进入「AI 笔记」，主导航提供 AI 对话、AI 笔记、截图日程和历史对话。进入「AI 笔记」创建笔记本，或打开已有 Markdown 目录。左侧文件列表、中央编辑器、右侧标题大纲与反向链接随窗口适配，两侧可以独立连续收起。文件和文件夹可拖入目录或移回根目录；`assets/` 在文件树中隐藏，附件仍可使用。

笔记支持实时预览、源码和阅读模式、自动保存、Wiki 链接、图片附件及 ZIP 导出。移除笔记本只取消应用中的链接，原文件保留。在笔记页点击「与 AI 讨论」，或在 AI 对话底部选择笔记上下文，可以生成创建、整理、补充和局部修改提案；查看完整差异后点击「确认并保存」才写入。取消、过期或文件发生冲突时不覆盖原文。预测分支设置也提供「用 AI 编辑已保存分支」，支持经确认的新增、编辑、删除自定义规则与调整顺序。截图浮窗的笔记写入同样逐次确认，完成后才回复并展示实际修改清单。详见 [AI 笔记说明](docs/AI_NOTES.md)和 [Phase 3 报告](docs/AI_CHAT_WORKSPACE_PHASE3.md)。

选定笔记本后，Agent 还可以通过 `run_command` 创建目录和移动文件，或通过 `run_script` 验证算法、批量整理笔记。命令在本机 OS 沙箱中运行，默认不联网、不继承应用密钥，单次最多 10 秒；执行完成后再回复，Markdown 变更列表来自真实文件核对。详见 [Agent 命令与脚本](docs/AGENT_COMMANDS.md)。

预测失败只显示脱敏错误和 HTTP 状态，不回显上游内容、Key 或图片；不会自动改用另一家模型。

## 项目目录结构

```text
Snipvia/
├── src/                         桌面应用
│   ├── main/                    Electron 主进程：系统能力、网络、文件与凭据
│   │   ├── index.ts             应用生命周期、服务组装与 IPC 注册
│   │   ├── agent/               Agent 循环、工具、权限、MCP 与网页检索
│   │   ├── ai/                  普通对话、视觉请求与 Agent 模型适配
│   │   ├── analysis/            截图内容分析和分支路由
│   │   ├── calendar/            Mac 日历和提醒事项写入
│   │   ├── capture/             截图引擎、ScreenCaptureKit / Electron 后端
│   │   ├── notes/               本地笔记目录、编辑保存、附件与导出
│   │   ├── performance/         截图性能事件与测量
│   │   ├── platform/            平台权限和开机自启适配
│   │   ├── storage/             设置、历史和日程存储
│   │   └── windows/             框选与置顶窗口、对话定位
│   ├── preload/                 向页面暴露有限的 IPC 桥接
│   ├── renderer/                桌面 React 页面、样式和资源
│   │   └── src/                 agent、capture、chat、notes 等界面
│   └── shared/                  桌面跨进程类型、Zod 校验及纯计算函数
├── native/
│   └── screen-capture-kit-helper/  macOS Swift 截图辅助程序
├── tests/
│   ├── unit/                    Vitest 桌面单元测试
│   ├── integration/             Playwright Electron 验收
│   ├── fixtures/                合成测试材料和本地 MCP 测试服务
│   └── helpers/                 跨测试辅助函数
├── scripts/                     开发启动、原生构建、打包、性能检查
├── build/                       图标、签名权限等打包输入资源
├── docs/                        产品、设计、功能、桌面发布与验证记录
├── package.json                 根工作区脚本与桌面应用依赖
├── pnpm-workspace.yaml          工作区成员与依赖安装策略
├── pnpm-lock.yaml               锁定依赖
├── electron.vite.config.ts      桌面三个进程的构建配置
├── electron-builder.yml         桌面应用分发配置
├── tsconfig.json                桌面 TypeScript 配置
├── eslint.config.mjs            全仓库 lint 配置
├── vitest.config.ts             桌面单元测试范围
└── playwright.config.ts         Electron 验收配置
```

桌面页面通过 **Renderer → Preload → Main** 请求系统能力；API 密钥、文件访问和模型网络调用由 Main 执行。`src/shared/` 管理桌面 IPC、纯逻辑与客户端需要的最小 HTTP 契约。

各模块的关键文件、调用流程、数据目录和「修改某项功能应该去哪里」见[项目结构详解](docs/PROJECT_STRUCTURE.md)。

## 数据与安全边界

| 数据 | 存放位置与行为 |
| --- | --- |
| 桌面模型 Key | Electron `userData/settings.json` 中的密文；使用 `safeStorage`，macOS 由钥匙串保护、Windows 使用 DPAPI |
| 对话和日程 | `userData/history/`、`userData/schedule/` 中的本地 JSON 与裁剪截图，当前不加密 |
| 笔记本 | 用户选择的目录内保存 Markdown 与附件；`userData/notebooks.json` 保存链接登记 |
| Agent 会话与笔记检查点 | `userData/agent-sessions/` 保存每个对话的完整 Agent 记录（含工具结果）；`userData/agent-checkpoints/` 保存每轮笔记修改前后的内容，供撤销，最多 100 份 / 64 MiB。均为本地 JSON、不加密，删除对话或清空历史时一并删除 |
| 预测内容 | 用户视觉模型接收选中裁剪图与适用条件；不发送执行 prompt、笔记本路径或账号 Cookie |

不将 `.env`、生产密钥、数据库、个人截图或用户数据提交到仓库。分类、问答、网页检索的接收方取决于用户配置；模型厂商的数据保留政策应由用户确认。本地优先不表示模型默认在本机运行。

Renderer 不直接读取文件或凭据；IPC 和模型输出均做校验。笔记只访问系统选择器授权的目录，拒绝路径穿越和符号链接。日程草稿的识别记录可以保存，但正式事项及外部日历写入必须经用户确认。

## 文档索引

### 产品与工程

- [产品需求](docs/PRD.md)、[技术设计](docs/TECHNICAL_DESIGN.md)、[路线图](docs/ROADMAP.md)。
- [UI 设计语言](docs/UI_DESIGN_LANGUAGE.md)：工作区与设置两种页面语言。
- [项目结构详解](docs/PROJECT_STRUCTURE.md)：目录职责、关键入口、数据流和修改指南。
- [macOS 开发与验收](docs/DEVELOPMENT.md)：权限、运行方式及平台检查。

### 桌面功能

- [自动截图理解](docs/AUTO_SCREENSHOT_UNDERSTANDING.md)、[普通截图与标注](docs/SCREENSHOT_EDITOR.md)、[AI 笔记](docs/AI_NOTES.md)。
- [Agent 运行时](docs/AGENT_RUNTIME.md)、[执行界面](docs/AGENT_EXECUTION_UI.md)、[工具系统](docs/AGENT_TOOL_SYSTEM.md)。
- [Agent 权限](docs/AGENT_PERMISSIONS.md)、[文件变更基础设施](docs/AGENT_FILE_CHANGES.md)、[MCP 适配](docs/AGENT_MCP.md)。
- [网页工具](docs/AGENT_WEB_TOOLS.md)、[联网研究与来源](docs/AGENT_WEB_RESEARCH.md)。
- [Agent 整理与确认写入笔记](docs/AGENT_NOTE_WRITING_PLAN.md)、[本地日程模型备选方案](docs/LOCAL_SCHEDULE_MODEL_PLAN.md)：逐次确认、写入保护与本地模型备选规划。

### 数据迁移

- [旧账号数据保留说明](docs/DESKTOP_ACCOUNT_AND_EMAIL.md)。
- [算法学习与笔记用例](docs/ALGORITHM_NOTE_SCENARIOS.md)：截图材料及确认写入验收。
- [日程截图测试包](docs/schedule-test-pack/README.md)：日期、时区、截止事项和歧义素材。

## 桌面分发

历史安装产物可从 [旧公开 GitHub Releases](https://github.com/yuyeyuyy/Snipvia-releases/releases) 获取：

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| macOS | `Snipvia-0.2.2-arm64.dmg` | macOS 14+ Apple 芯片；Developer ID 签名、Apple 公证 |
| macOS | `Snipvia-0.2.2-x64.dmg` | macOS 14+ Intel；签名、公证通过，真机验收待完成 |
| Windows | `Snipvia-Setup-0.2.1-x64.exe` | Windows 11 x64；尚未代码签名，完整兼容性需真机验收 |

`pnpm dist:friend` 生成 Apple 芯片体验 ZIP；`pnpm dist:windows-friend` 生成 Windows 免安装包；`pnpm dist:release` 生成 DMG、EXE、说明及 SHA-256。版本取自根目录 `package.json`，发布前运行本机检查和 [Windows 发布验证模板](docs/ci/windows-release.yml)。

正式 Mac 签名 / 公证使用独立[发布流程](docs/MACOS_RELEASE.md)；`pnpm release:publish --directory <verified目录> --notes <说明.md>` 默认校验公开发布计划，加 `--execute` 才上传并发布到当前 `Snipvia` 的 Releases（本阶段未发布）。新验收报告必须记录当前公开更新源，不覆盖已发布版本。迁移的旧 v0.2.1 不包含后来加入的自动更新功能。

正式 Mac 安装与更新步骤见[公开安装指南](https://github.com/yuyeyuyy/Snipvia-releases/blob/main/docs/INSTALL.md)，体验包的详细步骤见 [Mac 说明](docs/FRIEND_INSTALL_GUIDE.md)、[Windows 说明](docs/WINDOWS_FRIEND_INSTALL_GUIDE.md)。本次 Mac 发行已完成签名与公证；不将个人 Key 或本机数据放入安装包。

## 许可

项目当前未授予开源许可，`package.json` 标记为 `UNLICENSED`。

当前源码的新版本检查、下载和发布计划统一使用 [Snipvia Releases](https://github.com/yuyeyuyy/Snipvia/releases)。旧安装包仍读取旧渠道；新免费版发布前不能删除旧 Release 或停用旧客户端所需服务。本阶段未签名、打包、迁移 Release 或停服。
