# Snipvia UI 2.0：阶段 3 日程与历史重构

日期：2026-10-09。本轮在阶段 2 的主窗口骨架与阶段 2.5 的 Monochrome 主题之上，改造截图日程和历史对话。继续使用 WorkspaceHeader、Button / IconButton / Input / Select / Dialog / LoadingState 和现有颜色 Token，没有新增颜色体系、状态管理框架或依赖。

## 截图日程

- 月历为主，右侧 272–360px 日期详情；月份、前后月和今天集中在日历工具行。日期格 64–84px，不将长标题和大色块塞入格子。
- 今天使用高对比实心日期；选择使用小灰底标签和细边框；日程是实心点，截图是空心点，截止事项是菱形。普通日期、今天、选中日期与有记录日期均有不同表达及可访问名称。
- 点击日期，右侧展示真实的全天、时间安排、截止事项与当天来源截图。来源记录保留识别中 / 失败状态；未确定日期的事件不会被假放入今天。
- 日期依旧复用 `eventDateRange`、Temporal 与现有事件字段，保持跨日、时区、全天截止事项及午夜结束排除下一天的规则。跨日详情显示完整起止日期，避免把前一天的开始时间误读为当天安排。切月限制日期长度，1 月 31 日切到 2 月不会跳到 3 月。
- 日期网格支持方向键、Home / End、PageUp / PageDown 和 Tab，焦点清晰可见。切月与今天按钮保留键盘焦点，不强制抢焦点。
- 识别记录与原有事件编辑迁移到公共原生 Dialog，保留来源截图、编辑字段、保存到截然、Mac 日历与 Mac 提醒事项。Esc / 背景关闭及焦点恢复由公共组件处理。
- 内容宽度低于 760px 时缩小右栏与留白，低于 600px 时上下排列。日历与详情独立滚动，详情底部保留本地与系统日历写入的说明。

本阶段遵循“保留原有业务行为”：当前未保存的结果仍显示真实的“未保存”，保存与系统应用写入仍是原有明确操作。本轮没有修改自动识别 / 自动保存规则，也没有新增待核对队列；阶段 1 原型中的自动保存流程没有被悄悄带入数据层。

## 历史对话

- 左侧 240–300px 对话列表，右侧弹性预览。行高约 56px，标题 / 模型 / 时间紧凑排列，取消旧大卡片和每行厂商图标。
- 今天、昨天与其他真实本地日期分组，标题吸顶；按真实时间排序，正确处理 UTC 与偏移时区。无效日期保留为“日期未知”，不伪造时间。
- 搜索框与厂商筛选固定在顶部。搜索标题、模型、厂商，支持多词匹配；不为检索批量读取消息、图片或上传内容。空历史与无匹配结果区分表达。
- 选择行显示灰底、加重文字与短竖线。鼠标悬停或键盘聚焦时展示删除图标；方向键 / Home / End 可连续选择。
- 预览展开时读取一条实际对话，展示原始问题、Markdown 回答、来源引用和已编辑文件的只读摘要。截图通过“查看来源截图”按需展开，原色与原始内容保持。
- 列表与预览各自滚动，预览为每条记录保留滚动位置；切换页面与主题时恢复。小于 720px 减少详情留白，小于 580px 时切为列表 / 详情两态，并提供返回按钮。
- 固定底部“继续对话”调用原有恢复入口，原始截图、消息、续拍标记和对话身份继续使用原有逻辑。
- 单条删除与全部清空均使用公共 Dialog，默认焦点在取消，明确说明会删除截图与消息。确认前不写入；清空作用于全部本地历史，而非当前筛选结果。失败保持弹窗与实际错误文本。

## 必要的只读接口

原 `history:open` 会切换活动截图并取消正在进行的请求，不能用于无副作用预览。因此仅增加 `history:read`，直接复用已有 `readConversation`，无需新 Provider、Service 或存储格式。

- IPC 仅允许 Main 窗口主 frame，沿用 `senderAllowed` 和 UUID 校验。
- 不改变活动对话、不取消 Agent / 普通请求、不修改更新时间、不写记录、不发送 AI 请求。
- 过期预览响应不能覆盖新选择；读取失败有局部提示与重试。
- 网页来源使用已有 Markdown / 引用组件，浏览预览时不自动请求 favicon；明确点击网页链接仍走现有受限浏览器入口。

## 业务保护

日程与历史的存储文件、事件 / 消息类型、截图关联及恢复入口保持。对本轮开始时文件哈希检查，115 个已有实现文件保持不变，包括存储、AI、截图捕获、窗口、平台、Agent、笔记及颜色 Token。

Main 只新增只读 handler；Preload 与共享 API 类型只增加对应方法。App 只接入加载状态与异步操作结果，原恢复、删除和清空的数据操作保持；确认从浏览器 confirm 移到公共 Dialog。没有更改 ScreenCaptureKit Helper、截图性能、账号或云端服务。

## 修改清单

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/schedule/SchedulePanel.tsx` | 月历选择、日期详情、键盘交互、公共弹窗；保留 EventEditor 业务 |
| `src/renderer/src/schedule/schedule.css` | 月历 / 日期详情布局与响应式中性样式 |
| `src/renderer/src/schedule/display.ts` | 日期筛选、来源记录分组、月份长度和时间显示辅助 |
| `src/renderer/src/history/HistoryPanel.tsx` | 分组列表、搜索 / 筛选、只读预览、滚动状态、删除确认 |
| `src/renderer/src/history/history.css` | 紧凑列表、详情和窄窗口样式 |
| `src/renderer/src/history/display.ts` | 本地日期分组、元数据搜索和时间排序 |
| `src/renderer/src/components/ui/EmptyState.tsx` | 复用两页的公共空状态 |
| `src/renderer/src/design/controls.css` | 公共空状态的 Token 样式 |
| `src/renderer/src/App.tsx` | 读取状态与原有操作结果接入 |
| `src/shared/contracts.ts` / `src/preload/index.ts` / `src/main/index.ts` | 狭窄的只读历史预览 API |
| `tests/unit/workspace-browsing.test.ts` | 时区 / 跨日 / 切月 / 搜索 / 分组测试 |
| `tests/integration/workspace-browsing.spec.ts` | 两页真实窗口、只读副作用、恢复、确认、重试、多尺寸与主题测试 |
| `tests/integration/desktop.spec.ts` | 更新原有回归的操作入口，保留业务断言 |
| `docs/UI_DESIGN_LANGUAGE.md` / `README.md` | 更新当前页面规范与源码状态 |
| `docs/UI_2_0_STAGE_3.md` / `docs/ui/ui2-stage3/*.png` | 本记录及真实 Electron 截图 |

清单只描述本任务，不包含工作区其他任务已经存在的改动。

## 验证

使用 Node.js 24.15.0、pnpm 11.1.3、Electron 44.4.1。测试数据为临时账号、临时目录、合成 JPEG 和 Mock 模型；未读取用户私人截图或使用真实 API Key。

- `pnpm lint`、`pnpm typecheck`、`pnpm build`：通过。
- `pnpm test`：58 个文件，936 项通过。
- 相关桌面回归：5 项通过，覆盖原有 desktop、appearance（2 项）、Monochrome 与新浏览场景。新场景额外复核来源截图原字节关联与没有滤镜的展示。
- 浏览、日期选择、筛选、切主题与打开编辑但取消后，原始 `jobs.json` / `conversations.json` 字节不变。
- 预览前后当前 `chat.state` 保持完全一致；点击“继续对话”恢复所选实际 conversationId。低权限 Pin 窗口被拒绝访问，非法 UUID 返回失败。
- 删除取消不写数据；确认后真实索引减少；清空取消保留数据，确认后索引为空。丢失截图显示实际错误，文件恢复后重试成功。
- 跨日、午夜结束、截止事项、截图创建日的本地时区、短月份 / 闰年、标题 / 模型 / 厂商搜索、多词匹配和未知日期均通过测试。
- 两页 Light / Dark 下分别在 840×600、1120×780、1600×1000 的实际 Electron 窗口校验，页面无横向溢出。图像内容不做灰度化。
- 已人工检查两页的 Light / Dark 与窄窗口截图：无蓝色强调，日历与列表没有大面积灰卡片堆叠，文字、边线与焦点保留当前中性 Token。

本轮运行相关桌面用例，未重新执行整套 smoke。阶段 2.5 记录的 Dock 退出清理超时未在此任务中修复或重新验证；Windows 真机、真实系统日历权限和安装包测试仍需相应环境。没有修改退出流程或放宽测试门槛。

## 页面截图

| 页面 | Light | Dark |
| --- | --- | --- |
| 日程 · 1120px | [浅色](ui/ui2-stage3/schedule-light-1120.png) | [深色](ui/ui2-stage3/schedule-dark-1120.png) |
| 历史 · 1120px | [浅色](ui/ui2-stage3/history-light-1120.png) | [深色](ui/ui2-stage3/history-dark-1120.png) |
| 日程 · 840px | [浅色](ui/ui2-stage3/schedule-light-840.png) | [深色](ui/ui2-stage3/schedule-dark-840.png) |
| 历史 · 840px | [浅色](ui/ui2-stage3/history-light-840.png) | [深色](ui/ui2-stage3/history-dark-840.png) |
| 日程 · 1600px | [浅色](ui/ui2-stage3/schedule-light-1600.png) | [深色](ui/ui2-stage3/schedule-dark-1600.png) |
| 历史 · 1600px | [浅色](ui/ui2-stage3/history-light-1600.png) | [深色](ui/ui2-stage3/history-dark-1600.png) |

截图来自真实 Electron renderer，系统绘制的红黄绿不包含在 Chromium 页面截图中；其原配置与安全间距保持。本轮仅更新源码，没有打包、发布或更新云端镜像。重启开发版可查看新页面。
