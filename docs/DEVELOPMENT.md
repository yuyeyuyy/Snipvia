# macOS 框架开发与验收

## 当前边界

本轮交付截图问答与后台日程草稿的可运行骨架，优先 macOS。PRD 与技术设计描述完整目标，不代表所有功能已实现。M0 尚未全部通过，不应提前标记其他里程碑完成。

- 截图只覆盖鼠标所在显示器，使用真实帧尺寸进行 DIP 到像素换算；不支持跨屏框选。
- 原生与 Electron 截图均先隐藏主窗口；复制、保存、关闭、取消（包括续拍）或截图失败后保持隐藏。点击「返回软件」恢复同一段对话；手动点击 Dock 或「显示截然」仍可打开。完整屏幕帧只供框选浮层使用，完成或取消后释放，不落盘或上传。
- 框选完成后复用独立的置顶截图窗，支持拖动、关闭和打开侧边对话。操作区以胶囊形式悬浮在图片外部下方；置顶窗获得焦点时按 `Control+C` 会把当前 JPEG 作为图片写入系统剪贴板并结束该截图流程。侧边对话窗根据截图两侧可用空间定位、允许调整大小，并在截图移动时跟随且保留当前尺寸；点击「返回软件」后在主窗口打开同一条本地对话。
- macOS 首次截图使用系统权限请求；此前拒绝或撤销后，系统不会反复显示首次请求，应用会弹出恢复引导并提供录屏设置直达和 Finder 定位。`pnpm dev` 首次运行会建立固定的 `~/Applications/截然 Dev.app`，标识为 `com.snipvia.desktop.dev`，通过 Launch Services 启动，后续只从外部加载源码和资源，不在普通重启时修改应用包。当前开发机没有 Apple Development 签名证书；macOS 26/27 不会自动登记临时签名的 ScreenCaptureKit 应用，因此首次需把 Finder 已选中的 `截然 Dev.app` 拖入录屏列表并打开开关。此后源码修改和重启沿用同一权限，不再进入 `node_modules` 选择 Electron.app。开发版与固定位置的打包应用 `Snipvia.app` 授权不共享。Electron 运行时版本变化时启动脚本拒绝自动替换开发应用，以免无提示地丢失 TCC 身份。应用声明 `NSScreenCaptureUsageDescription`；正式分发需改用稳定的 Developer ID 签名并公证。不要用 `tccutil reset` 作为普通恢复流程。
- 图片长边最多 2400 像素，JPEG 品质 90；最近 6 轮对话传给模型，更早内容只留在当前界面。
- 使用完整响应，支持手动取消、120 秒超时；后续增加流式协议与逐供应商能力检测。
- 设置、加密凭据、截图、会话历史和日程草稿已持久化；当前存储使用原子写入的 JSON 索引和独立 JPEG 文件，尚未迁移至设计中的 SQLite。API Key 由 Electron `safeStorage` 加密，密文保存在 `settings.json`；macOS 使用钥匙串保护应用加密密钥并将文件权限设为 `600`，Windows 使用当前用户的 DPAPI。应用内定时提醒、ICS、去重及“不保存历史”模式尚未实现。
- `CommandOrControl+Shift+Space` 启动独立的新截图对话，`CommandOrControl+Shift+Enter` 启动一次新框选，并把新截图接入最近一条会话的原消息上下文；续拍模式不运行 OCR、Vision 分类或自动 Action，直接等待用户追问。历史记录仍使用原 conversation ID，当前截图替换为新图，消息和标题继续保留。两个组合都可在设置中实时录制。普通截图完成后，Auto Screenshot Understanding 通过本地 OCR 信号或视觉分类判断是否存在可执行日程，并自动启动结构化提取，不显示手动「记入日程」按钮。有时间范围的内容保存为 `event`，只有完成期限的内容保存为 `deadline`，不会为了截止事项编造开始/结束时间。系统通知只表示草稿已生成，不表示日程已保存。
- 设置中的「截图预测」持久化每个内容类型对应的自动 Action。内置分支可即时开关；全部匹配分支关闭时进入等待提问状态。用户新增的分支包含名称、截图类型和模型指令，并在相同类型下优先于内置分支；自定义分支最多与全部分支合计 30 条。
- Mac 日历和提醒事项写入使用各自 JXA/AppleScript 字典作为开发预览适配器。打包应用声明 Apple Events 用途并为主程序配置自动化 entitlement；系统授权入口是“隐私与安全性 → 自动化”中 Snipvia 控制“日历”或“提醒事项”，开发模式可能显示 Electron。只有用户在草稿页读取目标列表、选择目标并再次点击确认后才写入。旧安装包必须重建才能包含新声明。写入失败时先检查目标应用是否已创建事项，避免超时后重复添加。Windows 目前只支持 Snipvia 本地日程，系统应用适配会返回不支持提示。
- Windows 复用 Electron API 与快捷键，平台层只提供基础接口；混合 DPI、安装包和权限错误需要后续专门验证。

## 自动检查

### 开发应用的系统图标

`pnpm icons:build` 从 `UI/Snipvia-2-mac.icon` 导出标题栏 PNG、`build/Snipvia.icns` 和 `build/SnipviaAssets.car`。`pnpm dev:prepare` / `pnpm dev` 把这两份系统资源同步到固定开发应用，设置 `CFBundleIconName=Icon`，并以内容摘要命名 ICNS，避免沿用旧资源名。同步后验证签名、更新应用修改时间并重新登记这个应用；路径与 Bundle ID 保持不变。日常启动资源一致时不重新签名。

同步需要改动应用包与签名，因此必须先退出开发应用；启动器发现默认开发进程仍在运行时会停止更新并提示退出，避免改写运行中的签名。

运行中的 Dock 图标使用 PNG，系统权限页面根据应用包和系统缓存读取图标，因此修改 Dock 不代表权限图标已刷新。图标同步后需重启开发应用，并关闭、重新打开已经显示的系统设置页面。此流程不操作录屏开关、不删除权限条目，也不执行 `tccutil reset`；已安装的旧 `Snipvia.app` 需要更新安装包才会使用新资源。

这类图标更新不保证临时签名应用在所有 macOS 版本上保留已有授权；如果系统要求重新授权，只由用户在系统设置中确认，不由工具自动添加或启用。

2026-10-07 已检查固定开发应用的版本化图标声明、分层资源一致性、签名及重复启动，并用 `NSWorkspace.icon(forFile:)` 读取到新版图标。下图是系统文件图标接口的输出；录屏授权条目和首次授权弹窗的实际显示仍需界面复验，不能用文件图标检查代替。

![系统读取的开发应用图标](ui/system-app-icon.png)

### 测试命令

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:smoke
```

烟测使用临时用户目录、合成图片和本地 mock 模型，不访问真实 AI 服务，不使用个人 API Key，也不截取真实桌面。验证实际 Electron 窗口、受限 preload、IPC 参数校验、设置保存、录屏权限恢复引导、置顶截图、跟随对话、返回主窗口续聊、后台日程识别和本地确认保存。自动测试不会修改真实录屏授权或写入真实 Mac 日历。

框架在 macOS Apple Silicon 开发环境通过类型检查、ESLint、单元测试及 Electron 烟测（含合成屏幕的框选、取消后再次截图）。开发模式页面与 preload 也已验证。真实屏幕授权、真实供应商、Intel 和 Windows 仍待验证。

## 厂商配置

`src/shared/providers.ts` 集中维护厂商、接口和视觉模型预设；仅「自定义服务」显示 URL 输入。新增厂商前确认其图片输入和 Chat Completions 协议兼容性，不将未适配的协议直接接入。预设依据 [OpenAI 模型文档](https://developers.openai.com/api/docs/models/gpt-4.1-mini)、[百炼视觉理解文档](https://help.aliyun.com/zh/model-studio/vision)、[Gemini 兼容接口文档](https://ai.google.dev/gemini-api/docs/openai) 配置；模型可用性仍取决于账号和厂商。

凭据按厂商与接口地址隔离，自定义服务换地址后不继承旧密钥。旧版明文或 AES-GCM `credentials.json` 会在首次读取时迁移为钥匙串保护的密文；只有新设置文件写入成功后才删除旧凭据和本地主密钥文件。更早的 `safeStorage` 密文也可继续读取。普通设置、历史与日程保留。测试覆盖加密往返、两种本地凭据迁移、迁移失败保留原件、密钥切换、删除、本地文件权限和旧配置兼容；桌面烟测使用自定义本地 mock 服务，不调用付费厂商。

模型回答使用 `react-markdown` 与 `remark-gfm` 渲染 GitHub 风格 Markdown。未启用原始 HTML 解析，远程 Markdown 图片只显示占位文案；链接仅允许无凭据的 HTTP(S) 地址，并由主进程再次校验后交给系统浏览器。用户消息继续按纯文本显示。

对话框左下角读取 `configuredModels`，允许在设置页保存过的厂商/模型之间切换；选择后同步更新当前默认模型，但不会修改对应的凭据。Return 发送，Shift+Return 换行，输入法组合状态不会触发发送。每条模型回答记录实际使用的厂商和模型，重新打开历史后仍可核对。

历史记录位于 Electron `userData/history/`：`conversations.json` 只保存元数据与消息，`captures/` 保存裁剪后的 JPEG。索引采用临时文件加原子重命名；索引损坏时拒绝覆盖。历史页支持重新打开、继续对话、单项删除和清空全部，对应截图随记录删除。API Key 已加密；截图、对话和日程内容目前不加密。

日程记录位于 `userData/schedule/`：`jobs.json` 保存识别状态、候选字段和外部写入结果，`captures/` 保存共享的来源截图。模型必须输出带偏移的 ISO 8601 时间或全天日期；`event` 校验开始/结束区间，`deadline` 单独校验 `dueAt` 或 `dueDate`。坏 JSON和字段缺失都会标记为失败。时间编辑使用 Temporal 与 IANA 时区转换，夏令时中不存在或重复的本地时间会被拒绝并要求调整。人物只写入备注，不创建与会者或发送邀请。Mac 日历对截止事项创建标题带“截止”的短事件；提醒事项以截止时间或事件开始时间作为到期时间。适配器通过 `/usr/bin/osascript -l JavaScript` 调用系统 Calendar 或 Reminders，参数以 JSON argv 传递，不经过 shell。正式发布应换用 EventKit，以便使用明确的授权、签名 entitlement 和结果核验。

通义千问预设包含 `qwen3.8-max`（新配置默认）、`qwen3.8-flash` 和原有 VL 模型，已保存的模型不自动替换。依据 [Qwen3.8 Max](https://help.aliyun.com/zh/model-studio/qwen3-8-max)、[Qwen3.8 Flash](https://help.aliyun.com/zh/model-studio/qwen3-8-flash) 及 [兼容接口参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)，Qwen 厂商下的 `qwen3.8-*`（包括手填快照版本）使用图像输入，并在 HTTP 请求顶层设置 `enable_thinking: false`、`preserve_thinking: false`，与当前非流式、仅保存最终答案的对话实现一致。其他厂商和自定义服务不附加这些专属参数。保留仍可使用的北京公共域名，业务空间专属域名可通过自定义服务配置。上述适配已由 mock 请求验证，真实模型调用仍需用户密钥实测。

`pnpm package` 只生成当前架构的应用目录，构建成功不能替代签名、公证、干净机器安装或其他架构验收。

## macOS 手动验收

- 首次请求屏幕录制权限；拒绝、授权后重启、撤销后重新截图。
- Retina 屏幕截图文字清晰；多显示器、负坐标副屏和屏幕热插拔。
- 菜单栏、`⌘⇧Space`、继续对话快捷键、自定义录制与冲突提示。
- 置顶截图拖动与关闭；`Control+C` 复制图片并关闭；图片外胶囊操作区；对话窗在左右侧动态定位、可调整大小并跟随移动；返回主窗口继续同一对话；第二快捷键必须先重新框选，再以新截图和原消息上下文继续对话且不触发意图分析。
- 关闭「解释代码」等内置预测分支后，对应截图不自动运行该 Action；新增、启用、关闭和删除自定义预测分支后立即生效并在重启后保留。
- Agent 自动判断日程；完成/失败通知、多个候选、缺失字段和坏 JSON。
- 日程草稿逐项确认；选择不同 Mac 日历或提醒事项列表；拒绝或撤销自动化权限时错误可见且不会误标记成功。
- 反向拖动、极小选区、屏幕边缘、Esc 取消，连续 100 次无残留窗口。
- 中文输入法、全屏 Space、应用切换、关闭窗口后重新打开。
- 真实视觉模型：图片内容可读、鉴权失败、断网、取消与超时提示。
- 确认只有裁剪图被上传，日志与明文设置不包含密钥。
- Apple Silicon 与 Intel 安装烟测分别记录，不推断跨架构兼容性。

## 平台接口

在 `src/main/platform/index.ts` 扩展平台差异，保持 renderer 与平台实现解耦。新增系统操作必须通过白名单 preload 和主进程 sender/schema 校验。Electron 截图 API 不保证请求尺寸就是返回尺寸，因此主进程会验证原生分辨率；参见 [DesktopCapturerSource 官方说明](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source)。

## Phase 1 本地优先开发

客户端不需要后台、数据库、账号或 SMTP。运行 `pnpm dev` 后可直接使用本地功能；AI 使用自己的模型设置。旧账号环境变量不再生效，旧 Cookie 保留但不读取。测试使用 `tests/helpers/desktop.ts`，不启动账号服务。新发布源为 `yuyeyuyy/Snipvia`，本阶段没有发布新安装包。
