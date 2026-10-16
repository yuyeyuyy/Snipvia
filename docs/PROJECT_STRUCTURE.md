# 项目结构详解

更新：2026-10-16。入口：[README](../README.md)。本文件介绍当前源码中的目录职责、关键文件、调用关系和修改位置；各功能的验证范围见对应功能文档。

## 工作区组成

根目录是独立 Electron 桌面工作区；服务端、控制台、官网与后台契约已迁入本地私有候选。当前客户端无账号服务依赖，分支预测直连用户配置的视觉模型。详见[分离报告](opensource/SEPARATION_REPORT.md)。

## 桌面主进程：src/main/

`index.ts` 组装服务、创建窗口、注册快捷键和 IPC，并协调截图、对话与历史。系统权限、网络请求、凭据和文件操作由 Main 执行，Renderer 通过 Preload 访问有限接口。

| 目录 / 文件 | 主要职责与关键入口 |
| --- | --- |
| `capture/capture-engine.ts` | 选择主后端与回退后端，处理初始化、截图失败和取消 |
| `capture/screen-capture-kit-backend.ts` | 调用 macOS Swift 辅助程序，处理截图帧、OCR 和状态 |
| `capture/electron-capture-backend.ts` | Electron desktopCapturer 路径与等待策略 |
| `capture/` 其他文件 | 屏幕源选择、缩略图尺寸、帧类型、健康状态与就绪策略 |
| `windows/capture-overlay-window.ts` | 复用全屏框选窗口，传递帧就绪、AI / 普通截图模式及资格提示 |
| `windows/screenshot-to-all-window.ts` | 复用置顶截图窗口，处理新截图、首轮显示和结束；后续帧统计不阻塞对话显示 |
| `windows/quick-chat-placement.ts` | 按显示器可用区域计算对话窗位置和边界 |
| `analysis/screenshot-analyzer.ts` | 本机 OCR 与用户视觉模型的分析协调；远端失败时等待手动操作 |
| `analysis/auto-action-router.ts` | 校验启用分支、置信度及日程信号，决定执行或等待提问 |
| `ai/provider.ts` | 普通问答、流式对话、截图分类、日程提取和输出校验 |
| `ai/chat-completion-options.ts` | 普通问答和 Agent 共用的厂商参数：非思考模式与固定采样限制 |
| `ai/models/` | 官方模型目录适配、带证据的能力映射、受限 HTTP、合成图验证与凭据隔离缓存；目录修订后自动更新缓存，不参与原推理流程 |
| `ai/llm/` | Agent 模型接口、Chat Completions 工具调用适配，以及可见文本流处理 |
| `notes/NotebookService.ts` | 授权笔记本、文件列表、读写、移动、链接改写、附件、冲突检查与 ZIP |
| `notes/registerNotesIPC.ts` | 注册笔记 IPC，调用系统目录 / 文件对话框并验证调用窗口 |
| `calendar/mac-calendar.ts` | Mac 日历与提醒事项的列举和用户确认后的写入；不提供双向同步 |
| `platform/index.ts` | macOS 录屏权限、帮助信息，以及 Windows 基础适配 |
| `platform/login-item.ts` | 打包应用的开机自启状态与设置 |
| `storage/` | 模型配置、对话历史、日程识别记录与正式事项 |
| `performance/screenshot-performance.ts` | 按截图会话收集事件、时间与资源信息，生成性能报告 |

所有本地入口均无需账号；AI 需要用户模型配置。系统权限、文件授权、IPC sender 和修改确认继续有效。

### Agent 子系统：src/main/agent/

```text
agent/
├── AgentLoop.ts                 模型 → 工具 → 模型的循环与结束条件
├── AgentRuntime.ts              运行句柄、取消及有界内存快照
├── ContextManager.ts            对话、工具结果和上下文预算
├── ProviderTurn.ts              一轮模型调用的协调
├── ToolRegistry.ts              工具定义与可用权限白名单
├── ToolExecutor.ts              输入验证、授权、超时与结果标准化
├── WorkspaceService.ts          工作区授权和路径访问能力
├── PermissionManager.ts         审批、授权范围与执行条件
├── FileChangeService.ts         文件变更、差异和撤销基础设施
├── permissions/                 风险判断、命令分析和授权登记
├── policies/                    路径访问规则
├── approval/                    权限确认窗口接入
├── tools/
│   ├── file/                    目录、文件检索和文件变更工具实现
│   └── web/                     搜索、取网页和分块读取工具
├── web/                         Exa / Brave / DuckDuckGo、HTTP 限制和正文处理
├── mcp/                         stdio 客户端、配置、工具适配和连接管理
├── ui/                          把运行事件转为界面快照、审批和网页来源
├── fileChanges/                 文本补丁计算
├── notes/                       笔记工具 Schema、Main 能力、原子提交与实际差异
├── commands/                    系统沙箱命令、标准输入脚本、进程取消及真实文件核对
└── types/                       Main 内部的 Agent / Tool 类型
```

底层通用文件变更与 MCP 实现存在，不代表桌面已开放这些工具。当前 `index.ts` 以 `readOnly: true` 并配置 NotebookWriter 与 CommandRunner 创建工具系统，允许工作区读取、网络读取、独立的笔记写入和 `workspace:execute`。笔记与命令工具只有选定笔记本的 Main 能力才能执行；通用文件修改、Undo 和外部 MCP 执行不能由模型自行启用。

`commands/registerCommandTools.ts` 声明 `run_command` / `run_script`；`CommandRunner.ts` 检查能力、资格和编辑器保存后执行；`ProcessSandbox.ts` 接入 sandbox-runtime、干净环境与进程组取消；`CommandFiles.ts` 核对 Markdown 的实际编辑、移动、删除。命令只作用于笔记本与私有临时目录，无额外 Renderer shell IPC。实现及平台边界见 [命令与脚本](AGENT_COMMANDS.md)。

网页检索默认提供商在 `web/defaultSearchProvider.ts` 中选择：配置 Brave Key 时优先使用 Brave；显式选择 DuckDuckGo 时使用该适配器；其余使用 Exa。网页和 MCP 返回内容属于不可信输入，不能授予文件权限。

## 桥接与界面

### src/preload/

`index.ts` 使用 contextBridge 暴露 `window.snipvia`。笔记、Agent、截图、历史、日程等 API 都对应固定 IPC 通道；页面不能传入任意通道或获取 ipcRenderer 对象。

增加 IPC 功能时，需要同时修改共享契约、Main 的窗口与输入验证、Preload 的窄接口，再接入页面。类型声明不能替代主进程运行时验证。

### src/renderer/

`index.html` 是页面入口；`src/main.tsx` 按窗口 hash 按需加载对应页面：

| 入口 | 页面 |
| --- | --- |
| 默认 | `App.tsx` 主窗口；初始进入 AI 笔记 |
| `#capture` | 框选与普通截图标注器 |
| `#pin` | 置顶裁剪图 |
| `#quick-chat` | 截图旁对话 |
| `#agent-permission` | 权限确认窗口 |

| 界面目录 / 文件 | 职责 |
| --- | --- |
| `App.tsx` | 主窗口导航、全局状态与内部会话继续视图；主导航暂时保留截图日程、AI 笔记、历史对话 |
| `components/` | 标题栏、共享 WorkspaceHeader、图标 |
| `agent/` | 流式回答、运行状态、来源、授权与笔记本选择 |
| `capture/` | 框选、置顶图、浮窗样式；`editor/` 提供标注模型、绘制与编辑器 |
| `chat/` | QuickChat 和安全 Markdown 渲染 |
| `notes/` | 文件树、拖拽、CodeMirror 编辑、预览、大纲、保存状态和笔记本管理 |
| `history/` | 历史列表、打开、删除与清空 |
| `schedule/` | 月历、识别记录、草稿编辑和用户确认保存 |
| `settings/` | 模型、快捷键、预测分支与设置；`ModelSelectRow` 将目录刷新和图片筛选整合至模型下拉框 |
| `permissions/` | 录屏权限卡片 |
| `assets/` | 桌面品牌资源 |
| `style.css` / `refined.css` | 基础样式与共享 UI 语言 |

工作区与设置页面沿用 [UI 设计语言](UI_DESIGN_LANGUAGE.md)。笔记组件按需加载，截图浮窗不加载整个笔记编辑器。

笔记 Markdown 的关键入口：`notes/NotesEditor.tsx` 初始化 CodeMirror 与 GFM 解析；`live-preview.tsx` 以 StateField 提供标题、代码框、表格和行内装饰；`NotePreview.tsx` 用 React Markdown + remark-gfm 渲染阅读模式；`NoteCodeBlock.tsx` 提供语言按钮和复制反馈；`code-language.ts` 按需加载官方语法并复用 Lezer 高亮。剪贴板写入通过 `notes:copy-code` 固定 IPC 交给 Main。

### src/shared/

桌面跨进程契约和无系统依赖的计算集中在这里：

| 文件 / 目录 | 内容 |
| --- | --- |
| `contracts.ts` | 设置、截图、聊天、日程和 window.snipvia 的公共类型与 Schema |
| `screenshot-understanding.ts` | 默认四个分支、可编辑条件、分析结果和自动任务状态 |
| `notes.ts` / `note-markdown.ts` | 笔记 IPC、路径输入、Markdown 标题和链接逻辑 |
| `agent/` / `agent-file-change.ts` | 运行、消息、审批、来源和差异等跨进程类型；`agent/note-writing.ts` 定义实际笔记修改元数据与 Markdown 路径限制 |
| `screenshot-editor.ts` | 标注输出请求与 PNG 校验 |
| `geometry.ts` | 屏幕坐标和裁剪像素换算 |
| `schedule-time.ts` / `schedule-calendar.ts` | 时间、时区、月历布局等纯逻辑 |
| `providers.ts` / `api-key.ts` | 9 个国内外官方厂商及自定义服务预设；移除厂商的历史凭据兼容、官方接口来源、模型重名区分、凭据作用域和 Key 输入检查 |
| `models.ts` | 统一 ModelInfo、ModelCapabilities 八项三态、来源与验证时间、模型目录 IPC Schema |
| `performance.ts` | 性能事件和报告契约 |

## 本地预测契约

`analysis/PredictionService.ts` 默认使用用户视觉模型；`ai/json-request.ts` 提供有界、可取消 JSON 传输；`shared/prediction-failure.ts` 提供脱敏模型错误。没有后台契约或 Cookie。

## 原生程序、脚本与测试

`native/screen-capture-kit-helper/main.swift` 是 macOS 辅助程序源码，负责屏幕能力与 OCR；`scripts/build-native-helper.sh` 编译到 `build/native/`。Windows 使用 Electron 后端。

`scripts/` 包括固定开发应用启动、原生检查、桌面分发、真实截图性能实验和网页搜索评估。实验报告描述特定环境，不代表所有机器的性能保证。

测试分为：

- `tests/unit/`：Vitest；纯计算、IPC / 输出校验、存储、权限、模型异常和本地数据边界。
- `tests/integration/`：Playwright；Electron 窗口与真实文件工作流。
- `tests/helpers/`：临时桌面启动与模型模拟夹具；不创建账号或后台服务。
- `tests/fixtures/`：合成数据与本地 MCP 测试服务；不用个人截图作为测试输入。

默认 `playwright.config.ts` 测桌面；真实服务端与浏览器测试已迁至私有工程。需要真实屏幕、权限和混合 DPI 的实验另有条件，不把跳过项记为通过。

## 构建输入、生成产物与运行数据

| 位置 | 分类 | 说明 |
| --- | --- | --- |
| `UI/` | 图标设计源 | `Snipvia-2-mac.icon` 是 macOS Icon Composer 分层资源；`Snipvia-Win.ico` / `.png` 用于 Windows 打包、托盘与标题栏 |
| `build/` 图标与 plist | 打包 / 开发输入 | Mac 源图标导出的 `Snipvia.icns`、单色托盘图标和 macOS 权限配置 |
| `build/native/` | 生成产物 | Swift 辅助程序，不手工修改 |
| `out/` | 桌面构建 | Main、Preload 和 Renderer 的编译结果 |
| 根 `dist/` | 分发产物 | 应用目录、安装包和发行包 |
| `.dev-runtime/`、`scripts/.build/` | 开发 / 实验产物 | 开发运行时和辅助构建缓存 |
| `test-results/`、`playwright-report/` | 测试产物 | 截图、trace 和报告 |
| `performance-results/`、`coverage/` | 检测产物 | 性能数据或覆盖率输出 |

`scripts/build-app-icons.mjs`（`pnpm icons:build`）在 macOS + Xcode 26+ 下使用锁定版本 electron-builder 的图标编译器，从 Mac 源图标导出 ICNS、标题栏 PNG 和 `build/SnipviaAssets.car`。Mac 打包直接编译 `UI/Snipvia-2-mac.icon`，生成现代系统的 `Assets.car` 和旧系统的 ICNS；Windows 直接读取 UI 中的资源。开发启动器在系统图标资源或声明变化时同步带内容摘要的 ICNS、`Assets.car` 与 `CFBundleIconName`，验证签名并重新登记固定应用；相同资源不会重复签名，应用路径与标识保持不变。

`scripts/build-tray-icon.mjs`（`pnpm icons:tray`，也由 `icons:build` 调用）把 `build/TrayTemplate.svg` 导出为透明黑色的 18px / 36px 菜单栏 PNG。Main 加载普通与 Retina 表示并设置系统模板标记，菜单栏按系统外观着色。

桌面运行数据位于 Electron userData，不在源码目录：`settings.json`、`account/session.json`、`history/conversations.json`、`schedule/jobs.json` 和 `notebooks.json`。笔记正文及附件位于用户授权的目录，登记文件只保存链接。开发与安装版 userData 独立。


## 常见修改入口

| 要修改的功能 | 优先阅读 / 修改 |
| --- | --- |
| 截图后窗口未显示、位置异常 | `main/index.ts`、`main/windows/`、`renderer/src/capture/`、`chat/QuickChat.tsx` |
| 新增或修改预测分支 | `shared/screenshot-understanding.ts`、`main/analysis/`、`renderer/src/settings/` |
| 笔记树、拖拽、保存或附件 | `renderer/src/notes/`、`main/notes/`、`shared/notes.ts` / `note-markdown.ts` |
| Agent 工具或授权 | `main/agent/`、`shared/agent/`、`renderer/src/agent/` |
| 界面框架与导航 | `renderer/src/App.tsx`、`components/AppTitleBar.tsx`、`refined.css` |
| 打包、域名、镜像更新 | `scripts/package-*.sh`、`scripts/macos-release/`、`electron-builder.yml` |

改 HTTP 协议时同步调整契约、服务端、调用端和测试；改 IPC 时同步调整 Schema、Main 验证和 Preload。修改生成目录不会成为持久源码变更，应回到对应入口后重新构建。

模型配置的下拉框与刷新行位于 `src/renderer/src/settings/ModelSelectRow.tsx`，由 `SettingsPanel` 复用；只将图片能力为 supported 的目录条目加入下拉选项。旧的 `ModelCatalogPanel` 表格组件已移除。
