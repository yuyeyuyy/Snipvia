# Snipvia UI 2.0：阶段 2.5 Monochrome 修正

日期：2026-10-09。客户端视觉统一为 Monochrome Minimalism。继续使用阶段 2 的布局、控件、Light / Dark / System 状态与跨窗口 IPC；本轮只修改调色板和界面状态表达。

## 新设计 Token

颜色的唯一来源是 [`src/shared/design-tokens.json`](../src/shared/design-tokens.json)，由原有生成脚本输出 renderer CSS。两套主题各有 83 个语义 Token，名称一致；所有颜色的 RGB 三个通道相等，包括透明遮罩和阴影。布局尺寸、字体系统、动画时长未改变。

| 语义 | Token | Light | Dark |
| --- | --- | --- | --- |
| 主背景 | `bg-window` | `#FAFAFA` | `#121212` |
| 顶栏 | `bg-chrome` | `#FAFAFA` | `#181818` |
| 侧栏 | `bg-nav` | `#F5F5F5` | `#181818` |
| 内容面板 | `bg-panel` | `#FFFFFF` | `#202020` |
| 弹出表面 | `bg-raised` | `#FFFFFF` | `#262626` |
| 输入框 | `bg-input` | `#FFFFFF` | `#202020` |
| 悬停 | `bg-hover` | `#F0F0F0` | `#282828` |
| 按下 | `bg-active` | `#DEDEDE` | `#3A3A3A` |
| 选中 | `bg-selected` | `#EBEBEB` | `#303030` |
| 主文字 | `text-primary` | `#171717` | `#F5F5F5` |
| 次要 / 辅助文字 | `text-secondary / text-muted` | `#686868` | `#A3A3A3` |
| 禁用文字 | `text-disabled` | `#929292` | `#737373` |
| 分隔线 | `border-subtle` | `#E5E5E5` | `#333333` |
| 控件边线 | `border-default` | `#D4D4D4` | `#404040` |
| 强边线 / 选中边线 | `border-strong / border-selected` | `#A3A3A3` | `#737373` |
| 主按钮 | `accent` | `#171717` | `#F5F5F5` |
| 主按钮文字 | `text-on-accent` | `#FFFFFF` | `#171717` |
| 主按钮悬停 / 按下 | `accent-hover / accent-active` | `#333333 / #404040` | `#D4D4D4 / #BDBDBD` |
| 焦点描边 | `focus` | `#171717` | `#F5F5F5` |
| 开启状态开关圆点 | `control-thumb-active` | `#FFFFFF` | `#171717` |
| 代码底色 | `code-bg` | `#F0F0F0` | `#181818` |
| 代码主文字 / 注释 | `code-text / code-comment` | `#262626 / #686868` | `#E5E5E5 / #A3A3A3` |
| 滚动条 / 悬停 | `scrollbar / scrollbar-hover` | `#BDBDBD / #929292` | `#525252 / #737373` |

浅色辅助文字从参考值 `#737373` 微调为 `#686868`，因为前者在 `#EBEBEB` 选中底上只有约 3.98:1 对比度；新值约 4.67:1。正常文字、次要文字和辅助文字在窗口、导航、面板、弹出层、悬停与选中背景上均通过至少 4.5:1 的自动检查。禁用控件单独降低对比度，不把其文字计为正常可操作文字。

深色弹出层使用 `#262626`，与 `#202020` 面板形成深度，不反转浅色颜色。阴影由中性黑加透明度构成。`focus-ring` 是中性焦点色混合透明度，键盘焦点另有明确实线描边，不依赖柔和光晕。

## 旧颜色替换

| 原使用位置 | 旧颜色或表达 | 当前表达 |
| --- | --- | --- |
| 主按钮、发送 / 停止、授权按钮 | `#0969D8` / `#81B4FF` 蓝色 | 高对比黑底白字 / 浅底深字 |
| 选中导航、模型、日期、文件、目录拖放 | `#E8F0FD` / `#263B5A` 蓝底 | 灰底、加重文字，主导航额外有 2px 指示线 |
| 焦点描边与光晕 | 蓝色 `focus` | 黑白实线；快捷导航输入区增加中性焦点边线 |
| 深色窗口与面板 | `#171A20` / `#1B1E25` 等蓝调深灰 | `#121212 / #181818 / #202020 / #262626` |
| 千问等模拟厂商徽标 | 紫色 `brand-violet-bg` | 中性徽标背景，删除品牌紫色 Token |
| 成功、警告、错误 | 绿 / 黄 / 红状态色 | 灰度表面，图标与明确结果文字 |
| 代码语法 | 粉色、青色、紫色等 | 灰度层级、关键字字重、注释斜体 |
| 标题栏品牌图标 | 彩色应用 PNG | 复用黑白托盘轮廓的 `currentColor` 矢量标记 |
| 截图选区及缩放点 | 系统蓝色 | 白线配深色边，保持跨截图背景可见 |
| 截图标注对象的选择框 | Canvas 固定蓝线 | 仅预览的深浅双层虚线，读取中性 Token |

没有引入渐变、灰度滤镜、新的 UI 框架或状态管理。源码扫描未发现桌面 UI CSS 的旧蓝色 / 蓝紫色、彩色渐变、蓝色 SVG fill / stroke 或硬编码颜色；生成的 CSS 仍由统一调色板管理。

## 交互状态

- Hover：小幅灰度变化，不改变控件尺寸。
- Active：独立 `bg-active / accent-active`，保留文字对比度。
- Selected：灰底与高对比文字；主导航有短竖线与加重文字，模型选项沿用原有勾选提示。
- Focus：清晰中性实线；主操作文字与背景至少 4.5:1，主要表面的焦点至少 3:1。
- Disabled：保留 `disabled` 的不可操作语义，降低对比度；开关圆点位置仍可判断原状态。
- Loading：原有旋转环、状态文字、流式进度保持；修正部分进度点与表面同色的问题。
- Success：勾选图标加「已保存 / 已开启 / 已关闭 / 已授权」等实际结果。
- Warning：感叹号与原有风险 / 隐私 / 权限文字；必要提示有中性强边线。
- Error：叉号与真实错误文本，保留原有 `role="alert"`；高风险权限加粗并有边框。
- Diff：保留真实 `+ / −` 前缀、增删计数和内容，以不同灰度区分行，不依赖红绿。

现有消息提示通过共享 CSS 加装饰性状态图标，屏幕阅读器继续读取原有文字，不重复播报图标。Agent 工具步骤已有状态图标，继续复用。原有开关以主进程保存结果为准，本轮不改变其异步更新行为。

## 内容保护与范围外项目

桌面界面样式已迁移；以下颜色有意保留，不属于待迁移的品牌 UI：

- 用户截图、笔记图片、聊天图片、网页来源的真实 favicon 不做任何滤镜或像素变换。
- 标注颜色选择器保留红、蓝、绿、黄等真实标注色；这些颜色是用户要写入截图的内容。绘图与导出仍保留原色，色板周围的控件与选中描边为黑白灰。
- `ScreenshotEditor.tsx` 只改标注对象的预览选择框；捕获、选区坐标、绘图模型、标注调色板、导出 PNG、复制与保存行为未变。
- Dock / 应用包 / 系统权限列表中的平台图标素材保持原件；标题栏界面采用新的黑白矢量表达。
- macOS 红黄绿、系统窗口控制、系统原生菜单或文件选择器、必要的第三方素材由系统或素材本身绘制，保留其颜色。
- 官网、管理控制台、独立阶段 1 原型与历史说明截图是其他工程或历史证据，本阶段未改造。

阶段 2 的主进程、Preload、持久化、版本快照、主题广播、React Activity 与导航结构未改。对本轮开始时文件哈希进行比较，125 个 Main / Preload / shared 非 Token 文件均保持不变；未修改 AI 服务、日程或历史存储、ScreenCaptureKit Helper、性能逻辑。

## 修改文件清单

| 文件 | 修改 |
| --- | --- |
| `src/shared/design-tokens.json` | 独立浅深灰度调色板、按下 / 开关圆点 / 选中边框 Token |
| `src/renderer/src/design/tokens.css` | 原生成脚本重新输出 |
| `src/renderer/src/design/controls.css` | 公共控件状态、开关对比度、语义图标、焦点与灰度原生控件 |
| `src/renderer/src/design/app-shell.css` | 当前导航指示线、按下反馈、标题栏标记、快捷导航焦点 |
| `src/renderer/src/components/Icon.tsx` | 复用托盘轮廓的主题矢量图标 |
| `src/renderer/src/components/AppTitleBar.tsx` | 标题栏换用黑白标记，不改窗口控制 |
| `src/renderer/src/refined.css` | 删除旧紫色徽标、修正主按钮 Hover、减少无意义选中底色 |
| `src/renderer/src/notes/notes.css` | 当前文件灰色选中、代码字重与注释层级 |
| `src/renderer/src/capture/capture-window.css` | 截图控件灰度、选区对比度、提示图标 |
| `src/renderer/src/capture/pinned-window.css` | 置顶截图错误提示图标 |
| `src/renderer/src/capture/editor/ScreenshotEditor.tsx` | 预览选择框从固定蓝色改为中性 Token |
| `tests/unit/monochrome.test.ts` | 两主题中性色、不影响图片、对比度与防回退检查 |
| `tests/integration/monochrome.spec.ts` | 真实控件 / 弹窗 / 导航颜色、焦点、开关和状态提示检查 |
| `tests/integration/appearance.spec.ts` | 保留原有验证，输出本轮截图目录 |
| `tests/helpers/appearance.ts` | 颜色探针放在控件父节点，兼容不能显示子节点的 input / select |
| `docs/UI_DESIGN_LANGUAGE.md` | 当前黑白灰规范与例外 |
| `docs/UI_2_0_STAGE_2.md` | 标明颜色规范已更新 |
| `README.md` | 当前源码视觉状态与本说明链接 |
| `docs/UI_2_0_MONOCHROME.md` | 本实施说明 |
| `docs/ui/ui2-monochrome/*.png` | 合成数据的真实 Electron 界面截图 |

本次清单不包含工作区中其他任务原有的修改。没有更新依赖或锁文件，没有打包或发布。

## 验证结果

验证使用 Node.js 24.15.0、pnpm 11.1.3、本机 Electron 44.4.1。所有截图和账号均为临时存储与合成数据，没有真实 API Key 或私人截图。

- `pnpm lint`、`pnpm typecheck`、`pnpm build`：通过。
- `pnpm test`：57 个测试文件、929 项通过。含两个主题的中性 RGB、文字与代码 4.5:1、按钮 / 焦点 / 开关对比度检查；现有系统主题、持久化和窗口初始化回归保持通过。
- `pnpm test:smoke`：27 项通过、1 项失败、11 项按原环境门槛跳过。失败的是既有 Mac Dock 图标 smoke：图标与 Dock 显示断言已完成，随后在 `instance.close()`（第 72 行）退出清理时超过 45 秒；不是颜色断言失败。
- 单独复核主题、控件、Dock 与合成性能共 5 项：4 项通过，Dock 同样在退出清理时超时。Light / Dark / System、跨窗口同步、重启持久化、公共控件、导航及合成性能检查通过；不将整套 smoke 描述为全绿。
- `git diff --check`：通过。
- 已有主题回归检查 Light / Dark / System、重启恢复、主窗口 / 置顶图 / 截图选区 / 新 AI 浮窗同步、透明根节点、编辑器实例与内容保持、840px / 1600px 无横向溢出。
- 公共控件检查覆盖真实按钮、IconButton、Input、Select、Dialog、快捷导航、开关、主导航、日历、历史；窗口 / 设置 / 浮窗 / 笔记保留既有页面结构。已人工检查设置、配置弹窗、快捷导航、笔记和 AI 浮窗的 Light / Dark 截图：没有蓝色强调、蓝调深灰或布局溢出。
- 截图编辑 smoke 验证原有复制、图片标注原色及 PNG 输出；关闭截图 / 复制不打开主窗口、返回软件 / 主动 Dock 打开行为保留。

没有更改用户 macOS 系统设置；系统跟随通过 Electron `nativeTheme` 事件验证。Windows 真机、安装包与真实原生权限 / 性能实验仍需要各自环境，不将跳过项目视为通过。第一轮既有性能 smoke 出现一次超时，单独复核与最后完整运行均通过。Dock smoke 在本轮最早一次完整运行中通过，之后两次在退出清理中超时；trace 显示图标与窗口可见性断言没有错误。该退出清理问题尚未解决，需在后续平台回归中调查。本轮没有修改退出、Dock 或性能代码，也没有放宽超时门槛。

## 真实应用截图

- [设置 Light](ui/ui2-monochrome/settings-light.png) / [Dark](ui/ui2-monochrome/settings-dark.png)
- [AI 笔记 Light](ui/ui2-monochrome/notes-light.png) / [Dark](ui/ui2-monochrome/notes-dark.png)
- [截图 AI 浮窗 Light](ui/ui2-monochrome/quick-chat-light.png) / [Dark](ui/ui2-monochrome/quick-chat-dark.png)
- [配置弹窗 Light](ui/ui2-monochrome/model-dialog-light.png) / [Dark](ui/ui2-monochrome/model-dialog-dark.png)
- [快捷导航 Light](ui/ui2-monochrome/command-palette-light.png) / [Dark](ui/ui2-monochrome/command-palette-dark.png)
- [日程 Light](ui/ui2-monochrome/schedule-light.png) / [Dark](ui/ui2-monochrome/schedule-dark.png)
- [历史 Light](ui/ui2-monochrome/history-light.png) / [Dark](ui/ui2-monochrome/history-dark.png)

截图来自 Chromium 页面，不包含系统绘制的红黄绿按钮；其原有配置、预留空间和行为保持。后续业务页面重构继续复用本调色板，避免重新引入蓝色；本轮不提前改造页面布局或业务流程。
