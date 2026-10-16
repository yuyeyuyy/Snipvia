# Snipvia 初期技术设计

版本：0.1 Draft · 日期：2026-09-16 · 对应需求：[PRD](PRD.md)

本文件是实施设计，不是已验证实现。框架精确版本在 M0 锁定，禁止直接依赖浮动 latest 进行发布。

当前框架优先 macOS，Windows 仅保留基础平台接口。依赖已在 `package.json` 与 `pnpm-lock.yaml` 锁定；实际已实现功能及尚未实现部分见 [开发与验收](DEVELOPMENT.md)。以下仍描述完整目标架构。

Agent 工具层已实现 Main 内的工具注册、只读访问、workspace 授权边界和带 diff 预览的文件写入及 [统一权限系统](AGENT_PERMISSIONS.md)；[Agent Runtime](AGENT_RUNTIME.md) 核心循环已基于 Provider 接口实现，已通过 [Agent Execution UI](AGENT_EXECUTION_UI.md) 接入主聊天和 QuickChat 默认开启的只读联网 Agent 模式，以及 Chat Completions Tool Calling/SSE 适配。产品入口暂时禁用文件写入、编辑、Undo 和外部 MCP 工具调用，底层实现保留。工具实现、限制和接入方式见 [Agent Tool System](AGENT_TOOL_SYSTEM.md)、[Agent 文件修改](AGENT_FILE_CHANGES.md) 、[Agent Web Tools](AGENT_WEB_TOOLS.md) 与 [Agent MCP 接入](AGENT_MCP.md)。

## 1. 技术选型

| 层 | 方案 | 原因与代价 |
| --- | --- | --- |
| 桌面 | Electron | 统一 Chromium、成熟多窗口/快捷键/截图 API；代价是安装包和内存较大 |
| UI | React + TypeScript + Vite | 共享交互与类型；保持 UI 与平台能力分离 |
| 工程 | pnpm，单仓库单桌面应用 | 初期避免多服务部署；提交 lockfile |
| 数据校验 | Zod 或同类运行时 schema | IPC、模型结构化输出、配置统一校验 |
| 本地存储 | SQLite，优先评估 better-sqlite3 | 事务、迁移与查询；须处理 Electron ABI 和各架构原生模块构建 |
| 凭据 | Electron `safeStorage`；macOS 钥匙串、Windows DPAPI；密文位于 `settings.json` | 按系统用户保护密钥；macOS 应用签名不稳定时可能重复授权 |
| AI | 主进程 Provider Adapter + HTTPS 流式请求 | renderer 不接触密钥；不同供应商不假定协议完全兼容 |
| 时间 | 支持 IANA 时区的成熟日期库，M0 锁定 | 明确处理 DST、时区和日期边界，禁止只依赖 Date 字符串解析 |
| 打包 | electron-builder | macOS DMG/ZIP、Windows NSIS 安装包 |
| 测试 | Vitest + 双端实机测试；按需 Playwright Electron | 单元验证纯逻辑，真实桌面验证权限和窗口行为 |

Tauri 2 可作为后续评估方案，但截图、平台桥接和权限仍需要专门处理。当前优先减少同时维护 Rust 与前端两套实现的成本。选 Electron 是本项目的交付取舍，不表示它在体积和资源占用上占优。

## 2. 进程与模块

```text
Renderer：截图遮罩 / 对话浮窗 / 日程草稿 / 历史与设置
    ↓ 窄接口 preload（contextBridge）
Main：WindowManager / CaptureCoordinator / AIService
      EventService / ReminderScheduler / Settings / Repository
    ↓
OS 截图与通知 | SQLite + 图片文件 | 凭据存储 | AI HTTPS
                                          └ v0.2 CalendarAdapter
```

renderer 只管理界面，不直接访问文件系统、数据库、API Key 或任意网络目标。main 持有系统权限与网络请求。耗时图像处理、大批数据处理放入 worker/utility process；不得阻塞主进程事件循环。

建议目录（实施时创建，不代表当前已有源码）：

```text
src/
  main/
    capture/ windows/ ai/ calendar/ reminders/ storage/ security/
  preload/
  renderer/
    capture/ chat/ quick-note/ history/ settings/
  shared/
    schemas/ types/ errors/
tests/
  unit/ integration/ fixtures/
resources/
docs/
```

## 3. 截图链路与坐标

状态机：`idle → preparing → selecting → cropped → panel`。失败或 Esc 统一进入 cleanup，销毁遮罩、释放帧、恢复焦点，再回到 idle。使用 captureSessionId 隔离过期异步回调。

1. 记录原前台窗口与显示器列表；检查权限和正在进行的截图会话。截图快捷键只等待 CaptureOverlay 预加载，不等待 ScreenshotToAll 浮窗预加载。
2. macOS 14+ 且 ScreenCaptureKit Helper 健康时，先立即显示透明的无边框选择层和准备提示，再并行取得显示器静态帧。`SCContentFilter` 按应用排除截然自身，选择层不会进入截图。
3. 同一帧到达 Renderer 并解码后，选择层原地切换为可框选状态；准备阶段不响应拖动，避免用户在冻结帧就绪前得到错误选区。
4. ScreenCaptureKit 不可用或失败时，先隐藏透明选择层，再隐藏业务窗口并等待隐藏完成，随后使用 Electron `desktopCapturer`。必须验证返回图像尺寸，不把小缩略图直接当原生清晰截图。
5. 每个显示器显示对应冻结画面的无边框选择窗口；用户起始拖动的显示器拥有本次框选。
6. 框选坐标从显示器局部 DIP 转成该帧实际像素，裁剪、检查边界和最小尺寸。
7. 释放所有完整屏幕帧，仅将裁剪图交给浮窗；取消时不落盘、不上传。
8. 浮窗锚定选区边界，在当前 display.workArea 内定位；恢复正常键盘输入。

坐标换算必须使用真实帧比例，而不是假设所有屏幕 scaleFactor 相同：

```text
localX = globalDipX - display.bounds.x
localY = globalDipY - display.bounds.y
ratioX = framePixelWidth / display.bounds.width
ratioY = framePixelHeight / display.bounds.height
pixelLeft = floor(localX * ratioX)
pixelTop = floor(localY * ratioY)
pixelRight = ceil((localX + selectionDipWidth) * ratioX)
pixelBottom = ceil((localY + selectionDipHeight) * ratioY)
```

取整后夹紧到图像范围。检查旋转屏幕的帧方向和纵横比。显示器在框选过程中插拔或改变缩放时，取消当前会话并重新采集。

macOS：权限名称和抓屏行为随系统及 Electron/Chromium 版本变化；M0 必须在目标系统上验证首次授权、拒绝、撤销和重启后的状态。不要为区域截图无条件申请辅助功能权限。原生全屏 Space、置顶遮罩、焦点恢复需要真机测试。

Windows：测试混合 DPI、输入法快捷键、全屏窗口；受保护内容或安全桌面可能无法抓取，返回可理解错误，不尝试绕过系统限制。

## 4. AI 请求

分离两种接口：

```ts
interface AIProvider {
  chat(input: ChatInput, signal: AbortSignal): AsyncIterable<ChatChunk>;
  extractEvents(input: ExtractInput, signal: AbortSignal): Promise<unknown>;
  testCapabilities(): Promise<{ vision: boolean; streaming: boolean }>;
}
```

输入包含裁剪图、当前问题、已选历史上下文。速记额外传入 capturedAt、用户 IANA 时区和可见消息日期证据。当前日期必须由客户端提供，不依赖模型自知“今天”。

当前 M0 日程识别使用设置中选定的视觉模型。主进程把截图时间换算为用户时区的当天，并在提示中明确今天至大后天；模型标注原文中的相对日期后，主进程再次按截图时区计算绝对日期并校验，避免仅相信模型的日期算术。月历按事件自身时区显示日期，跨周时间段拆成连续的周内条形，双击后编辑原草稿。

图片压缩设定长边和字节上限，保留细小文字可读性；尺寸与请求总量限制在 M0 根据选定供应商核实。只发送裁剪图，禁止把全屏帧误传给模型。首版直接用视觉模型，独立 OCR 作为后续优化接口。

上下文设 token/图片预算，超过时保留原图和近期轮次，压缩旧文本并说明已概括。每个流事件携带 sessionId/requestId，避免新截图后旧回答进入新会话。

连接与首输出超时目标 30 秒，整体上限目标 120 秒；两者可按实际供应商调整。支持用户取消。部分响应标记 interrupted；聊天不在后台无限自动重试，用户显式重试生成新的 attemptId。

结构化输出若供应商支持 schema 则启用；否则解析 JSON 后严格校验。最多一次格式修复请求，仍失败则返回可编辑空草稿与错误，不直接创建日程。

## 5. 日程提取和数据契约

```ts
type Evidence = {
  field: string;
  text: string; // 来自截图的依据；未必是可靠 OCR 原文，UI 仍提供图片核对
  origin: 'image' | 'inferred' | 'user_default' | 'user';
};

type EventDraft = {
  id: string;
  sourceCaptureId: string;
  kind: 'event' | 'deadline' | 'note' | 'reschedule';
  title: string;
  startLocal: string | null; // YYYY-MM-DDTHH:mm，含义由 timeZone 确定
  endLocal: string | null;
  allDay: boolean;
  startDate: string | null; // 全天日期
  endDateExclusive: string | null;
  timeZone: string; // IANA
  location: string | null;
  reminderMinutesBefore: number | null;
  referenceDate: string | null;
  referenceDateSource: 'visible_message' | 'capture_time' | 'user' | 'unknown';
  evidence: Evidence[];
  unresolvedFields: string[];
  warnings: string[];
};
```

模型输出中的字段一律不可信，主进程验证枚举、长度、日期合法性和时区。不要将模型自己给出的 confidence 当作真实准确率。使用“原文明确 / 推断 / 待补充”描述不确定性。

保存前将本地时间解析为 UTC instant，并保留原时区；遇到 DST 歧义让用户确认。全天事件保留日期区间，不能先转 UTC 零点再跨区显示。`kind != event` 的草稿先由用户明确转为事件或截止提醒；首版不建设完整待办系统。

保存状态：`draft → confirmed → saved_local`。外部导出与同步作为独立状态保存，不替代本地状态：`none | exported | pending | synced | failed | unknown`。

## 6. 本地存储与提醒

数据置于 Electron app.getPath('userData') 的应用目录，而非源码目录。

| 表 | 关键字段 |
| --- | --- |
| captures | id、relativePath、width、height、sha256、capturedAt、sourceTimeZone |
| conversations | id、captureId、createdAt、updatedAt |
| messages | id、conversationId、role、content、status、requestId |
| event_drafts | id、captureId、payloadJson、status |
| events | id、title、startUtc/endUtc 或全天日期、timeZone、location、revision |
| event_sources | eventId、captureId |
| reminders | id、eventId、eventRevision、triggerAt、status、lastAttemptAt |
| calendar_operations | idempotencyKey、eventId、provider、externalId、status、errorCode |
| settings | key、valueJson；不存 API Key 明文 |
| settings.json 中的 encryptedKeys | 按厂商和 endpoint 隔离的 `safeStorage` 密文；macOS 文件权限 `0600` 且钥匙串保护加密密钥，Windows 使用 DPAPI |

UUID 作为内部 ID，数据库迁移按序号执行。事件、提醒与操作记录采用事务保存；写图片用临时文件加原子重命名，失败清理孤儿文件。开启 SQLite 外键；迁移前备份，失败回滚并显示恢复提示。

去重分两层：同一个确认操作用唯一 idempotencyKey 防止双击；不同截图按标题规范化、时间和地点生成候选重复提示，允许用户明确选择保留两条。

提醒调度从数据库读取最近触发点，最多每 30 秒重新核对，同时监听系统恢复。编辑事件在事务中作废旧提醒并创建新 revision。重启进行漏发检查；notification 提交 OS 不代表用户已看到，不能承诺端到端 exactly-once。用 delivered/submitted 状态与记录减少重复。

图像默认随关联历史保留，提供“不保存历史”和“清空全部”。清理时检查会话及日程引用，避免悬空外键。无历史模式下仍需保存用户明确创建的日程，默认不附图，并告知该差异。

## 7. 日历接入

### v0.1：本地日程 + ICS

ICS 使用稳定 UID、DTSTAMP、正确 DTSTART/DTEND、CRLF、文本转义和行折叠。计时事件优先导出 UTC 时间，全天事件用 VALUE=DATE 和排他的 DTEND。设置提醒时生成 VALARM，但目标客户端是否遵守需要验证。

打开或保存 ICS 只能标记 exported，不能标记 synced。重复导入是否合并取决于目标客户端，稳定 UID 不足以保证所有客户端不重复。

### v0.2：真正直写

```ts
interface CalendarAdapter {
  authorize(): Promise<void>;
  listWritableCalendars(): Promise<CalendarRef[]>;
  createEvent(event: ConfirmedEvent, operationId: string): Promise<ExternalRef>;
  getEvent(ref: ExternalRef): Promise<ExternalEvent | null>;
  deleteEvent(ref: ExternalRef): Promise<void>;
}
```

- 首选评估 Microsoft Graph 作为两端共享实现，面向拥有兼容 Outlook/Microsoft 365 日历的用户；这不代表覆盖所有用户。
- 桌面 OAuth 采用系统浏览器和授权码 PKCE；应用注册视为 public client，不在安装包内嵌 client secret。申请满足读写核验的最小授权范围；撤销授权和令牌刷新失败有明确恢复路径。
- macOS 原生日历作为独立 EventKit adapter。需 Swift/Objective-C 桥接与签名。仅写权限不满足完整日历读取/核验流程；按最终操作设计申请权限，不能为了“最小权限”声称仅写即可完成所有功能。
- 后续 Google Calendar 单独适配。Windows 不假设存在统一的本地日历写入接口。
- 创建结果保存 externalId；超时后先查找/核验结果，不能盲目重发导致重复。Graph 可评估 transactionId，具体保证以接口文档和实测为准。
- 首版接入只创建当前用户自己的事件，不设置 attendees；“撤销”只删除明确由本应用创建的指定事件。

当前 macOS 开发预览先通过 Calendar 和 Reminders 的 JXA/AppleScript 字典实现目标枚举与单次创建，以验证交互。主进程使用 `execFile` 直接调用 `osascript`，结构化参数经 argv 传入；renderer 无法传脚本或文件路径。访问可能分别触发两个系统应用的 macOS 自动化权限。此适配器没有稳定幂等、创建后读取核验或沙盒 entitlement 方案，因此不能替代正式 EventKit 实现，也不扩展到 Windows。

日历账户注册、权限审核、测试账号与双端网络可达性是 v0.2 依赖，未完成前保留本地能力。

## 8. IPC 与安全边界

最小接口：capture.start/cancel、chat.send/cancel、draft.extract、event.save/update/delete、calendar.export、settings.update、history.list/delete。

每个接口校验 senderFrame、窗口角色、请求 schema 和资源归属；主进程根据 captureId 解析文件，禁止 renderer 传任意文件路径或任意 IPC channel。使用统一错误码：PERMISSION_DENIED、CAPTURE_FAILED、MODEL_UNSUPPORTED、AI_TIMEOUT、INVALID_DRAFT、STORAGE_ERROR、CALENDAR_UNKNOWN。

BrowserWindow 强制 nodeIntegration=false、contextIsolation=true、sandbox=true；preload 仅暴露白名单函数。加载本地应用资源，CSP 限制脚本源；模型 Markdown 禁用原始 HTML 或严格净化，不执行代码块。外部 URL 只允许受控 http/https scheme，并经系统浏览器打开。

API Key 只由 main 读写，按厂商和 endpoint 隔离后由 Electron `safeStorage` 加密。密文随普通设置写入 `settings.json`；macOS 应用加密密钥由钥匙串管理，Windows 使用当前用户的 DPAPI。设置文件使用临时文件和原子重命名；macOS 文件权限为 `0600`。旧版明文及 AES-GCM 本地凭据在成功写入新设置文件后删除，较早的 `safeStorage` 密文继续可读。密钥不进入 renderer、聊天记录或日志。macOS 开发版与打包版的应用身份不同，钥匙串可能分别授权；正式分发需要稳定签名以避免反复授权。

模型 endpoint 只允许用户在设置中配置，默认 HTTPS；自定义厂商支持用户明确填写的 HTTP 或 HTTPS 地址（包括局域网和远程地址），内置厂商仍使用固定接口。HTTP 传输不加密；endpoint 不接受内嵌用户名、密码、查询参数或片段。禁止把密钥随重定向发送到不同来源。日志不包含图像、原文消息、模型请求体或密钥。

### 开机自启设置

`src/main/platform/login-item.ts` 通过 Electron 的登录项 API 读取和修改系统状态，设置页不另外保存可能过期的布尔值。Windows 注册当前 `Snipvia.exe` 路径与 `--snipvia-autostart` 参数，读取时使用同一组路径和参数，并检查任务管理器中的启用状态。系统登录启动只显示托盘，手动启动正常显示主窗口。免安装包应放在固定位置，移动目录后需要重新开启自启。开发模式不注册 Electron；macOS 使用系统登录项 API。Windows 注销/重启后的实际启动行为仍需真机确认。

截图中的提示是输入数据，不能覆盖系统规则。模型只能返回回答或草稿；外部日历操作必须由用户确认后的结构化对象发起。

## 9. 构建与验证

- macOS arm64、macOS x64、Windows x64 分别构建和测试。macOS 签名在 macOS 环境执行。
- CI 在源码工程建立后加入 lint、typecheck、unit、package；依赖安装使用冻结 lockfile。
- SQLite 原生模块匹配目标 Electron ABI 和架构，安装包必须在干净机器上验证，不能只测试开发环境。
- 外部分发 macOS 使用 Developer ID 签名、公证与必要的 stapling；Windows 安装包代码签名以降低来源不明提示，不能保证消除所有系统信誉提示。
- 证书和公证凭据只存 CI secret；PR 工作流不接触发布密钥；发布由明确触发流程执行。
- 已接入启动版本检查与设置页更新入口；正式签名 Mac 安装版使用固定 `electron-updater 6.8.10` 下载完整 ZIP、校验 SHA-512，并在用户选择重启后先确认笔记保存，再通过原生签名更新机制安装。普通退出不自动安装；Windows 签名更新与独立回滚仍为后续能力。现有手动安装与数据迁移保留，见[客户端版本检查与更新](UPDATE_CHECK.md)。
- 单元测试聚焦坐标、时区、ICS、去重、IPC 校验；集成测试使用可控 AI mock 验证取消、断流和坏 JSON。最终至少完成真实模型烟测与双端权限测试。

## 客户端账号接入（2026-10-03 实现）

账号服务已迁至独立私有工程。客户端主进程 `account/AccountService.ts` 通过固定 API 调用邮箱验证码认证和本人资格接口，Renderer 使用受主窗口身份约束的窄 IPC，长期会话 Cookie 不跨 IPC。会话经系统安全存储加密写入 `account/session.json`，绑定来源与有效期；安全存储不可用时仅保留内存会话。Agent 访问规则保护账号存储目录。

登录和退出串行，网络错误保留有效本机凭据，停用及会话到期清除；退出在掉线时仍清除本机存储并报告远端撤销未完成。正式构建的账号来源通过 `MAIN_VITE_CONSOLE_ORIGIN` 设置，要求 HTTPS。开发来源可使用本机 HTTP，服务端公开配置解决网页与 API 端口不一致时的 Origin 校验。

当前普通截图可在本机使用，截图 AI 与部分 Agent 入口仍检查账号资格；本轮未改变这些业务规则。服务端邮件、预测密钥与部署文档已迁至私有工程，客户端兼容边界见[桌面账号说明](DESKTOP_ACCOUNT_AND_EMAIL.md)。

## 10. 官方参考与核实范围

以下官方资料于 2026-09-16 查询，用于确认能力和约束；调用签名应在 M0 对照锁定版本再次确认。

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)：桌面捕获 API 与平台差异。
- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)：全局快捷键注册。
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)：隔离、IPC 和不可信内容。
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)：渲染进程沙箱边界。
- [electron-builder Multi Platform Build](https://www.electron.build/docs/features/multi-platform-build/)：跨平台构建与 macOS 签名约束。
- [Apple EventKit](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)：日历访问与授权。
- [Microsoft Graph Create event](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0)：创建事件与权限。

本文件中的内部架构、性能目标和阶段安排是本项目的设计决策，不是这些文档对 Snipvia 的性能保证。
