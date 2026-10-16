# Snipvia UI 2.0：阶段 2 实施记录

> 当前颜色规范见 [阶段 2.5 Monochrome 修正](UI_2_0_MONOCHROME.md)，本文保留阶段 2 的工程记录。

日期：2026-10-09。实施第一阶段推荐的 A 布局：紧凑左导航、统一顶部工具栏、复用两套页面语言。本轮只实现主题系统、公共组件规范和主窗口骨架，独立原型未接入生产应用。

## 已实现

- Light / Dark / System，默认跟随系统；在「设置 → 外观 → 主题」实时切换。
- 主题作为 `settings.json` 顶层 `appearance.mode` 保存，复用原子写入和 0600 权限。旧设置默认 System；外观设置与厂商、模型、密钥分开，切换模型不重置主题。
- 主进程的 `AppearanceService` 统一设置 `nativeTheme.themeSource`、读取 `shouldUseDarkColors`、监听 `updated`，向所有已有窗口发送主题快照。新窗口也自动注册。
- Preload 在 React 创建前取得一次同步、只读的内存快照；HTML 提前加载 Token CSS，系统媒体查询覆盖启动时尚未设置属性的阶段。主窗口原生背景、Windows 标题栏覆盖颜色和权限窗口背景也使用同一调色板。
- 快照有递增版本，防止较早的初始化事件覆盖新主题。变更主题只更新 DOM 属性和原生窗口颜色，不用主题作为 React key，不销毁编辑器。
- 一个 `AppShell` 替换原骨架；删除旧 CSS 中重复的标题栏和侧栏定义。侧栏为 176px / 52px，连续过渡；≤1050px 默认紧凑，可手动展开，用户主动收起的偏好继续保留。
- 顶部全局操作：快捷导航、账号、设置。⌘K / Ctrl+K 打开快捷导航；⌘, / Ctrl+, 打开设置。现有权限或业务弹窗持有焦点时不抢占快捷键。未增加顶部 AI 截图按钮。
- `WorkspaceHeader` 继续作为唯一工作区页头，44px 高、14px 标题；设置保留分组行语言。公共内容留白为 16px / 24px，窄窗口为 12px / 16px；设置公共宽度 720px。业务页内部分栏暂时保留。
- 已访问页面通过现有 React 的 `Activity` 保留局部状态，隐藏时暂停 Effects，不额外增加布局容器。笔记继续使用原有常驻与 `active` / flush 机制，保护保存和 Agent 写入前刷新。

## 设计 Token 与组件

唯一调色板位于 [`src/shared/design-tokens.json`](../src/shared/design-tokens.json)，包括：

| 分类 | 主要 Token |
| --- | --- |
| 表面 | `bg-window / chrome / nav / panel / raised / input / hover / disabled` |
| 文字 | `text-primary / secondary / muted / disabled / selected / on-accent` |
| 边线和状态 | `border-subtle / default / strong`、`accent / focus`、`success / warning / danger` 及各自背景 |
| 选中 | `bg-selected / selected-inactive / user-message` |
| 代码 | `code-bg / text / keyword / string / number / function / variable / type / comment` |
| 控件与弹出层 | `control-thumb`、`scrollbar / scrollbar-hover`、`shadow-control / popover / window`、`focus-ring` |
| 跨截图对比度 | `capture-mask / selection-* / dimension-* / hint-*`、`overlay-control-*` |
| 尺寸与动画 | 字体、字号、间距、圆角、120 / 180 / 220ms、`ease-ui`、导航和标题栏尺寸 |

浅色为冷白和中性灰，深色独立定义层次与文字对比度。所有 renderer CSS 颜色使用 Token；旧别名也指向语义变量。截图遮罩、选框和尺寸标记保持原有颜色值。绘制到图片里的标注颜色不是界面主题，未修改。

修改调色板后执行：

```sh
node scripts/generate-design-tokens.mjs
```

生成 [`design/tokens.css`](../src/renderer/src/design/tokens.css)，供 HTML 首屏使用；测试检查生成值与源调色板一致，防止原生窗口与 CSS 漂移。

| 控件 | 本轮处理 |
| --- | --- |
| Button / IconButton | 统一样式与焦点；图标按钮有可访问名称与原生 Tooltip |
| Input / Select | 复用原生控件，新增轻量包装用于外观和快捷导航；不替换模型配置业务 |
| Dropdown / Popover | 复用原有模型选择、笔记菜单、来源等实现，接入主题颜色 |
| Dialog | 快捷导航复用原生 `<dialog>` 的焦点约束、Escape、焦点恢复；业务确认窗保留原有行为并接入主题 |
| Sidebar / Toolbar | `AppShell`、`AppTitleBar` 与 `WorkspaceHeader`，全局操作有 toolbar 语义 |
| Switch / Tabs | 保留原有 checkbox 与选项组及其业务事件，统一语义颜色、聚焦和选中态 |
| ScrollArea | 保留原滚动容器，统一亮暗滚动条 |
| EmptyState / LoadingState | 复用现有业务空状态；新增公共加载状态，快捷导航使用紧凑空状态 |

未引入新依赖或状态管理框架。原有业务组件的尺寸和内部布局不在本轮全面替换。

## 窗口与业务保护

- 主窗口仍为 1120×780，最小 840×600；48px 原生标题栏与 macOS 红黄绿位置保持。原型的 44px 标题栏暂不直接用于原生窗口，避免按钮重叠。
- 保留拖动区、按钮 no-drag 区、最小化 / 最大化 / 关闭、现有窗口尺寸行为、隐藏主窗口与手动 Dock 打开等流程。
- macOS 的透明窗口背景读取可能省略 alpha；已有截图、置顶和 AI 浮窗的黑色透明原生背景不被主题填充，根节点同样保留透明。
- 权限窗口只修改初始背景颜色；授权范围、原始主 frame 检查、过期和取消逻辑均保留。外观写入仅允许主窗口，其他窗口只能接收或读取。
- 与本轮开始时的文件摘要对比：44 个受保护的非 CSS 源文件保持不变，覆盖捕获窗口、平台适配、AI、笔记、日程、历史和模型配置数据逻辑。
- 没有修改 ScreenCaptureKit Helper、截图捕获 / 性能优化、笔记编辑 / 保存、日程事务、历史存储、模型请求或会员判断。

## 修改文件

以下清单只记录本阶段；仓库在本轮开始前已有控制台、厂商和原型变更。

| 类别 | 文件 |
| --- | --- |
| 主题契约和调色板 | `src/shared/appearance.ts`、`src/shared/design-tokens.json`、`src/shared/contracts.ts` |
| 主进程 | `src/main/appearance.ts`、`src/main/index.ts`、`src/main/storage/settings.ts`、`src/main/agent/approval/createPermissionPrompt.ts`（只改初始背景） |
| Preload 与首屏 | `src/preload/index.ts`、`src/renderer/index.html`、`src/renderer/src/main.tsx` |
| 公共骨架 | `components/AppShell.tsx`、`components/AppTitleBar.tsx`、`components/Icon.tsx`、`App.tsx` |
| 公共组件和外观设置 | `components/ui/Button.tsx`、`Dialog.tsx`、`LoadingState.tsx`、`settings/AppearanceSettings.tsx`、`settings/SettingsPanel.tsx` |
| 公共样式 | `design/tokens.css`、`design/controls.css`、`design/app-shell.css`、`style.css`、`refined.css` |
| 现有界面主题适配 | `notes/notes.css`、`account/account.css`、`agent/execution.css`、`agent/sources.css`、`agent/file-approval.css`、`capture/capture-window.css`、`capture/pinned-window.css`（renderer 路径） |
| 生成和编译 | `scripts/generate-design-tokens.mjs`、`tsconfig.json`（JSON 模块支持） |
| 新测试 | `tests/unit/appearance.test.ts`、`tests/integration/appearance.spec.ts`、`tests/helpers/appearance.ts` |
| 原测试适配 | `tests/unit/settings.test.ts`；桌面、账号、Agent、笔记拖拽、笔记导航、截图会员 integration 中的尺寸、主题颜色、导航顺序和可见页面断言 |
| 文档与图片 | `README.md`、本记录、`UI_DESIGN_LANGUAGE.md`、`UI_2_0_DESIGN_REVIEW.md`、`docs/ui/ui2-stage2/` |

## 验证

所有接口测试使用 Mock；所有截图测试使用合成图片与临时存储，没有发送真实模型请求或采集私人屏幕。

- `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。
- `pnpm test`：56 个文件、924 项通过。
- 新增真实 Electron 测试覆盖 Light / Dark / System、现有窗口同步、新创建 AI 浮窗、低权限窗口拒绝修改主题、透明背景、模型配置不受影响、重启恢复、笔记内容与编辑器实例保持、设置页面实例保持、快捷导航和 840 / 1600px 窗口无横向溢出。
- 原桌面回归覆盖页面打开、导航动画、原生拖动安全区、文件移动、Markdown、保存冲突、历史、截图、复制、取消、返回软件、会员撤销和 ScreenshotToAll 重用。
- `pnpm test:smoke`：27 项通过、11 项按原有环境门槛跳过。包括真实权限 / 原生性能实验、安装包与 Windows 真机检查，跳过项目不算验证通过。

系统变化测试通过真实 Electron `nativeTheme` 事件驱动；本轮没有修改用户的 macOS 系统设置，也没有宣称完成手动系统外观切换、Windows 真机或混合 DPI 测试。截图性能只做已有合成 smoke 回归，没有重新测量真实 ScreenCaptureKit 基准。

## 视觉证据

- [设置浅色](ui/ui2-stage2/settings-light.png) / [设置深色](ui/ui2-stage2/settings-dark.png)
- [笔记浅色](ui/ui2-stage2/notes-light.png) / [笔记深色](ui/ui2-stage2/notes-dark.png)
- [AI 浮窗浅色](ui/ui2-stage2/quick-chat-light.png) / [AI 浮窗深色](ui/ui2-stage2/quick-chat-dark.png)

已检查真实 Electron 截图：标题栏和内容无多余空列，深色页面无白色面板，控件与代码保持可读。截图不包含系统绘制的窗口控制按钮；其原生配置、安全间距和现有行为另由测试检查。

## 下一阶段

1. AI 笔记：按确认方案重做内部文件树 / 编辑器 / 大纲比例，继续保护光标、输入法、撤销、保存冲突、拖拽和 Agent flush。
2. 历史对话：列表搜索与同屏详情；保留现有本地历史和续拍行为。
3. 日程与设置：约60%主月历 / 紧凑日期详情及设置分类；「取消待核对、直接存入本地日程」属于后续业务阶段，本轮未更改。Mac 日历与提醒事项写入仍是独立操作。
4. 浮窗：两态与原生窗口合并单独验证，不随主题骨架顺便更换窗口拓扑。
5. 发布前补充真实 macOS 外观切换、权限窗口、Windows 控制区、混合 DPI、可访问性和原生截图性能检查。

本阶段没有重新打包或发布。重启开发版后可以查看新界面；既有 v0.2.1 安装包不包含这些源码变化。

## API 兼容依据

本地 Electron 版本为 44.4.1，已核对其 TypeScript 声明与 [nativeTheme 官方文档](https://www.electronjs.org/docs/latest/api/native-theme)、[BrowserWindow 官方文档](https://www.electronjs.org/docs/latest/api/browser-window)。主题复用现有应用生命周期和 IPC，不改系统窗口控制实现。
