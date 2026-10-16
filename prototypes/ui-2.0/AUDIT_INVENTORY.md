# 当前 UI 审查文件清单

审查日期：2026-10-09。此清单描述现有正式代码，不表示已经重构。设计决定见 [阶段 1 审查方案](../../docs/UI_2_0_DESIGN_REVIEW.md)。

## Renderer

| 已阅读文件 | 职责与处理方向 |
| --- | --- |
| [App.tsx](../../src/renderer/src/App.tsx) | 页面状态、订阅与布局；重排外壳，保护笔记常驻与对话转交 |
| [account/AccountPanel.tsx](../../src/renderer/src/account/AccountPanel.tsx) | 邮箱认证与资格；保留冷却/事务与设置语言，适配主题 |
| [account/account.css](../../src/renderer/src/account/account.css) | 邮箱认证与资格；保留冷却/事务与设置语言，适配主题 |
| [agent/AgentExecution.tsx](../../src/renderer/src/agent/AgentExecution.tsx) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/AgentNotebook.tsx](../../src/renderer/src/agent/AgentNotebook.tsx) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/AgentPermissionPanel.tsx](../../src/renderer/src/agent/AgentPermissionPanel.tsx) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/NoteChanges.tsx](../../src/renderer/src/agent/NoteChanges.tsx) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/SourceReferences.tsx](../../src/renderer/src/agent/SourceReferences.tsx) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/activity.ts](../../src/renderer/src/agent/activity.ts) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/execution.css](../../src/renderer/src/agent/execution.css) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/file-approval.css](../../src/renderer/src/agent/file-approval.css) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/sources.css](../../src/renderer/src/agent/sources.css) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [agent/useAgentExecution.ts](../../src/renderer/src/agent/useAgentExecution.ts) | 状态、审批、文件变更、来源与对应样式；保留控制权与安全接口，精简过程展示 |
| [capture/CaptureOverlay.tsx](../../src/renderer/src/capture/CaptureOverlay.tsx) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/PinnedCapture.tsx](../../src/renderer/src/capture/PinnedCapture.tsx) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/capture-window.css](../../src/renderer/src/capture/capture-window.css) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/editor/EditorIcon.tsx](../../src/renderer/src/capture/editor/EditorIcon.tsx) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/editor/ScreenshotEditor.tsx](../../src/renderer/src/capture/editor/ScreenshotEditor.tsx) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/editor/draw.ts](../../src/renderer/src/capture/editor/draw.ts) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/editor/model.ts](../../src/renderer/src/capture/editor/model.ts) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [capture/pinned-window.css](../../src/renderer/src/capture/pinned-window.css) | 框选、标注、贴图与样式；保护会话/坐标/退出，浮窗独立设计验证 |
| [chat/MarkdownMessage.tsx](../../src/renderer/src/chat/MarkdownMessage.tsx) | 流式消息、Markdown 与快捷浮窗；保留安全渲染、意图优先与取消 |
| [chat/QuickChat.tsx](../../src/renderer/src/chat/QuickChat.tsx) | 流式消息、Markdown 与快捷浮窗；保留安全渲染、意图优先与取消 |
| [components/AppTitleBar.tsx](../../src/renderer/src/components/AppTitleBar.tsx) | 共享页头/图标；复用职责并统一尺寸和语义 |
| [components/Icon.tsx](../../src/renderer/src/components/Icon.tsx) | 共享页头/图标；复用职责并统一尺寸和语义 |
| [components/WorkspaceHeader.tsx](../../src/renderer/src/components/WorkspaceHeader.tsx) | 共享页头/图标；复用职责并统一尺寸和语义 |
| [env.d.ts](../../src/renderer/src/env.d.ts) | window.snipvia 类型桥；保持受控 IPC |
| [history/HistoryPanel.tsx](../../src/renderer/src/history/HistoryPanel.tsx) | 历史列表与删除；重设为搜索列表与同屏详情 |
| [main.tsx](../../src/renderer/src/main.tsx) | 按窗口 hash 选择 renderer 和样式加载；保护加载顺序与透明入口 |
| [notes/NoteCodeBlock.tsx](../../src/renderer/src/notes/NoteCodeBlock.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/NoteIcon.tsx](../../src/renderer/src/notes/NoteIcon.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/NotePreview.tsx](../../src/renderer/src/notes/NotePreview.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/NotesEditor.tsx](../../src/renderer/src/notes/NotesEditor.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/NotesOutline.tsx](../../src/renderer/src/notes/NotesOutline.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/NotesPanel.tsx](../../src/renderer/src/notes/NotesPanel.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/NotesTree.tsx](../../src/renderer/src/notes/NotesTree.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/code-language.ts](../../src/renderer/src/notes/code-language.ts) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/live-preview.tsx](../../src/renderer/src/notes/live-preview.tsx) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/note-drag.ts](../../src/renderer/src/notes/note-drag.ts) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/notes.css](../../src/renderer/src/notes/notes.css) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [notes/useNoteDocument.ts](../../src/renderer/src/notes/useNoteDocument.ts) | 笔记文件/文档/Markdown/UI；复用编辑器、保存、路径与拖拽逻辑，重排分栏/控件 |
| [permissions/ScreenPermissionCard.tsx](../../src/renderer/src/permissions/ScreenPermissionCard.tsx) | 系统截图权限；保留受控系统操作和应用身份 |
| [refined.css](../../src/renderer/src/refined.css) | 共享规则与精修覆盖；计划迁移为唯一 Token/组件规则 |
| [schedule/SchedulePanel.tsx](../../src/renderer/src/schedule/SchedulePanel.tsx) | 日期、草稿编辑、记录与系统目标；重新组织月历和详情，保留事务 |
| [settings/ModelSelectRow.tsx](../../src/renderer/src/settings/ModelSelectRow.tsx) | 设置、模型选择与快捷键；复用 scope/缓存/校验，重组分类与控件 |
| [settings/SettingsPanel.tsx](../../src/renderer/src/settings/SettingsPanel.tsx) | 设置、模型选择与快捷键；复用 scope/缓存/校验，重组分类与控件 |
| [settings/shortcut.ts](../../src/renderer/src/settings/shortcut.ts) | 设置、模型选择与快捷键；复用 scope/缓存/校验，重组分类与控件 |
| [style.css](../../src/renderer/src/style.css) | 共享规则与精修覆盖；计划迁移为唯一 Token/组件规则 |

## Main、preload 与相关设计

- `src/main/index.ts`：阅读窗口创建、预热/显示、关闭、Dock 激活、对话转交、笔记 flush、相关 IPC 注册及 senderAllowed 分支。没有对无关服务端业务声称逐行审查。
- `src/main/windows/capture-overlay-window.ts`、`screenshot-to-all-window.ts`、`quick-chat-placement.ts`：完整窗口封装及屏幕 workArea 定位规则。
- `src/preload/index.ts`：窄桥的消息、笔记、权限、日程、设置、模型与截图接口。
- `src/main/storage/history.ts`、`schedule.ts`：本地索引、截图、原子写入/回滚、删除与结果字段。
- `src/main/storage/settings.ts` 与 NotebookService：配置迁移、加密凭据/作用域及文档/文件事务相关入口。
- `docs/UI_DESIGN_LANGUAGE.md`、`PRD.md`、`TECHNICAL_DESIGN.md`：两种页面语言、产品/权限/存储边界。
- `docs/WEBSITE_VISUAL_SYSTEM.md`：官网是独立工程，本轮没有改官网。

## 审查事实与验证分开

阅读代码能确认职责、接口和当前数据流，不能代替运行真实窗口的结果。历史缺陷以已有回归逻辑为保护对象；本轮只运行独立浏览器原型与现有静态/单元检查。多屏、录屏权限、Windows 真机及合并窗口仍需阶段 2 验证。
