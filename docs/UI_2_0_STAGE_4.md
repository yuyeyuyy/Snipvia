# Snipvia UI 2.0：阶段 4 AI 笔记与设置

日期：2026-10-09。本阶段在现有 AppShell、WorkspaceHeader 与 Monochrome Token 上改造两页。未新增依赖、主题状态管理、数据格式或 AI 协议；本记录只描述本轮改动，不包含工作区已有的其他任务。

## AI 笔记

- 移除工作区内的卡片外框、阴影与侧栏按钮外框，文件树使用窗口背景，编辑器使用内容面板，靠留白与细分隔线表达层级。
- 默认文件树展开、大纲收起；宽内容区域文件树与大纲各 200px。内容不足 900px 时文件树为 184px，大纲按需成为 212px 辅助浮层；不足 620px 时文件树也成为可关闭浮层，正文不再被三栏同时挤压。
- 两侧收起保持连续宽度与透明度过渡，隐藏时 inert，开启减少动态效果时直接切换。关闭后不残留造成横向溢出的边框；展开状态与编辑内容在页面、导航与主题切换时保留，未新增跨重启的侧栏偏好存储。
- 文件标题旁放新建笔记 / 文件夹，工具行保留刷新、排序、自动定位与折叠。右键与行末操作、拖拽、悬停展开、边缘滚动及根目录目标保持；assets 继续隐藏。
- 返回、路径、格式动作与模式选择合并为轻量文档工具栏。紧凑窗口格式动作换行；阅读模式隐藏格式动作。导出及侧栏开关继续位于 WorkspaceHeader。
- 编辑 / 阅读正文最大宽度 760px（包含横向留白），15px 系统字体、1.85 行高，宽屏居中。保存状态与字数使用 28px 底栏，冲突提示及磁盘版本 / 另存副本操作保持。
- 阅读模式的引用使用中性竖线、次要文字；行内代码引用 code-bg / code-text。表格保持 GFM 列对齐与内部横向滚动，单元格和交替行分别使用主题表面。
- 实时预览和阅读代码块沿用现有 Lezer 语法解析与语言复制，code-* 灰度 Token 不变；关键字 / 运算符加重，注释灰色斜体。源码、缩进和复制字节不变。

未重写 Markdown 编辑引擎。实时预览仍沿用原有显示与选中时显露源码规则；引用的语法解析、表格点击位置、标题 padding 与 StateField 测量没有更改。

## 设置

- 复用原 settings-preferences 壳，最大 880px，24px / 32px 留白，20px 标题。分类跳转行吸顶，按钮只滚动并聚焦当前页标题，不改变 hash 路由或卸载组件。
- 六类为通用、外观、模型配置、快捷键、隐私与数据、关于；截图预测归入模型配置子组，启用、编辑、自定义新增及笔记本绑定均保留。
- 设置行最小 60px，13px 名称与 12px 说明，控件统一右对齐。移除分组卡片的背景、外框与阴影，使用标题间距和行间细线。
- 外观继续使用原 Light / Dark / System、默认系统、持久化和跨窗口同步。选择器使用公共 Select 与既有黑白灰 Token。
- 厂商配置复用公共 Button / Input / Select；刷新在模型下拉左侧，结果和错误仍使用原 ModelSelectRow。模型清单缓存、图片能力筛选、手动 ID、平台地区、凭据作用域及保存验证保持。
- 厂商、预测分支、隐私与笔记弹窗统一使用公共原生 Dialog，保留内容滚动和底部动作。Tab 不逃出弹窗，Esc 关闭；笔记删除 / 移除链接默认取消焦点，关闭后恢复来源焦点。保存中不能关闭模型 / 分支弹窗。
- 隐私与数据展示真实的本地存储、附件备份及系统加密说明，使用既有隐私说明入口，不增加未实现的清理开关。关于使用 package.json 的实际版本及当前平台，UI 2.0 设计编号不是发布版本。

## 业务保护

对任务开始时 136 个文件记录哈希，135 个保持不变；唯一变化是 AppearanceSettings 标题增加 tabIndex，以便分类跳转后聚焦。

- 全部 Main、Preload、Shared 实现保持，包含主题服务、设置 / 凭据存储、笔记存储、IPC、AI、截图捕获、平台和窗口逻辑。
- NotesEditor、useNoteDocument、NotePreview、live-preview、code-language、NoteCodeBlock 与 note-drag 保持原文件；自动保存、冲突检测、退出 flush、Undo、链接更新、附件与沙箱边界不变。
- AppShell、App、全局 Token 与快捷键转换不变。没有修改 ScreenCaptureKit Helper、截图后窗口行为或截图性能优化。
- 设置提交继续使用既有完整配置，密码仍仅通过既有 IPC 保存给主进程；未增加日志、第三方转发或真实接口测试。

公共 Dialog 修正了 React 移除节点后的显式焦点恢复，并支持既有 data-initial-focus 标记；这是弹窗交互修正，不改变确认决策或文件操作。

## 改动清单

| 文件 | 本轮改动 |
| --- | --- |
| src/renderer/src/notes/NotesPanel.tsx | 默认按需大纲、连续工作区、合并文档工具栏、公共控件 / Dialog |
| src/renderer/src/notes/NotesTree.tsx | 文件标题与操作位置、窄布局关闭入口；原操作函数保持 |
| src/renderer/src/notes/NotesOutline.tsx | 按需面板关闭入口，标题跳转与反向链接保持 |
| src/renderer/src/notes/notes.css | 居中正文、两侧布局 / 动画、Markdown 表面与窄窗口策略 |
| src/renderer/src/settings/SettingsPanel.tsx | 六类分组、分类跳转、隐私 / 关于、公共控件及原生弹窗 |
| src/renderer/src/settings/settings.css | 紧凑行、取消卡片外框、配置弹窗与响应式样式 |
| src/renderer/src/settings/AppearanceSettings.tsx | 分组标题可程序聚焦；主题逻辑保持 |
| src/renderer/src/settings/ModelSelectRow.tsx | 原生表单替换为公共 Button / Select / Input；查询逻辑保持 |
| src/renderer/src/components/ui/Dialog.tsx | 初始焦点与 React 卸载后的来源焦点恢复 |
| tests/integration/notes-preferences.spec.ts | 两页布局 / 文件 / 焦点 / 主题 / 设置取消与真实窗口截图 |
| tests/integration/notes.spec.ts | 显式打开默认关闭的大纲，适配辅助面板布局断言，原文件业务断言保持 |
| tests/integration/notes-navigation.spec.ts | 按需大纲及新宽度断言；动画 / 冲突 / 取消链接断言保持 |
| README.md、docs/UI_DESIGN_LANGUAGE.md | 源码状态与两页设计规范 |
| docs/UI_2_0_STAGE_4.md、docs/ui/ui2-stage4/*.png | 本记录与 20 张真实 Electron 截图 |

## 测试结果

使用 Node.js 24.15.0、pnpm 11.1.3、Electron 44.4.1。全部采用临时目录、合成笔记 / 图片、Mock 账号与模型，没有使用真实 API Key 或私人截图。

- pnpm lint、pnpm typecheck、pnpm build：通过。
- pnpm test：58 个文件、936 项通过。初次受限环境的 16 项 macOS 沙箱命令失败，在正常本机权限下全部通过；未修改或禁用这些测试。
- 相关 Playwright Electron 回归：14 项通过。覆盖 appearance（2）、desktop、model-catalog（2）、monochrome、notes-drag、notes-markdown（2）、notes-navigation、notes-preferences、notes、provider-settings、workspace-browsing。
- 笔记创建 / 打开 / 编辑 / 自动保存 / 快捷键保存 / 退出保存、目录创建、重命名、链接更新、拖拽移动、附件导入 / 粘贴、ZIP 导出、磁盘冲突另存副本与取消链接均通过。
- 实时预览点击文字、代码行与表格单元格后，在对应源文件行写入；Undo 恢复字节。代码语言按钮复制原文，HTML 不执行，大纲跳转与反向链接保持。
- 主题切换保持 EditorView 身份和编辑内容；Light / Dark / System、运行时系统变化、Pin / Capture / QuickChat 同步及重启偏好均通过。
- 模型刷新、缓存、失败保留目录、跨厂商响应竞态、接口密钥隔离、模拟加密、配置校验错误和模拟图片 Agent 请求通过；没有宣称真实厂商 API 联调。
- 原生弹窗默认取消、Tab 焦点约束、Esc / 关闭后焦点恢复、取消配置不写设置通过。
- 两页 Light / Dark 在 840×600、1120×780、1600×1000 检查，无横向溢出；默认大纲隐藏时编辑器占工作区至少 65%，正文最大 760px。已人工检查亮暗、实时编辑、大纲、窄窗口、快捷键与厂商弹窗截图。
- 阶段 3 日程 / 历史只读预览、删除确认及数据字节保护回归通过；本轮所有新增颜色引用现有 Token，没有蓝色 UI 或图片灰度滤镜。

未运行整套 smoke，也未打包发行；Windows 真机、安装版开机自启 / 系统凭据权限仍需要对应环境。阶段 2.5 曾记录的 Dock 测试退出清理超时不在本轮修复范围，本轮未重新验证该项。

## 页面截图

| 页面 | Light | Dark |
| --- | --- | --- |
| 笔记 · 1120px | [浅色](ui/ui2-stage4/notes-light-1120.png) | [深色](ui/ui2-stage4/notes-dark-1120.png) |
| 设置 · 1120px | [浅色](ui/ui2-stage4/settings-light-1120.png) | [深色](ui/ui2-stage4/settings-dark-1120.png) |
| 笔记 · 840px | [浅色](ui/ui2-stage4/notes-light-840.png) | [深色](ui/ui2-stage4/notes-dark-840.png) |
| 设置 · 840px | [浅色](ui/ui2-stage4/settings-light-840.png) | [深色](ui/ui2-stage4/settings-dark-840.png) |
| 笔记 · 1600px | [浅色](ui/ui2-stage4/notes-light-1600.png) | [深色](ui/ui2-stage4/notes-dark-1600.png) |
| 设置 · 1600px | [浅色](ui/ui2-stage4/settings-light-1600.png) | [深色](ui/ui2-stage4/settings-dark-1600.png) |
| 实时编辑 · 1600px | [浅色](ui/ui2-stage4/notes-live-light.png) | [深色](ui/ui2-stage4/notes-live-dark.png) |
| 展开大纲 · 1600px | [浅色](ui/ui2-stage4/notes-outline-light.png) | [深色](ui/ui2-stage4/notes-outline-dark.png) |
| 厂商弹窗 · 1600px | [浅色](ui/ui2-stage4/provider-light.png) | [深色](ui/ui2-stage4/provider-dark.png) |
| 快捷键 / 数据 · 1600px | [浅色](ui/ui2-stage4/shortcuts-light.png) | [深色](ui/ui2-stage4/shortcuts-dark.png) |

截图来自真实 Electron renderer，系统红黄绿不在 Chromium 页面截图中；原生按钮及安全间距未改。本轮只更新源码，重启开发版可查看；旧安装包需后续重新打包。
