# UI 2.0 阶段 6：Monochrome 全局验收

## 范围与结论

本轮审查 Electron 客户端，包含截图日程、AI 笔记、历史、截图 AI 浮窗、设置、导航、菜单、弹窗和状态。官网与云端控制台沿用各自设计语言，不在本轮范围内。

Light / Dark 主要页面在真实 Electron 窗口中检查，主窗口覆盖 840×600、1120×780、1600×1000 DIP；浮窗覆盖紧凑、展开与 340×360 窄窗口。截图与笔记使用临时合成数据，模型和账号使用 Mock。没有通过截图滤镜或改变用户内容实现黑白灰。

应用 Token、导航、常规控件已统一为中性灰。本轮发现并修复 CodeMirror 动态注入样式和搜索面板布局的遗漏。此结论限于已检查的页面与交互；原生系统控件和未具备条件的平台检查见文末。

## 发现及修复

| 问题 | 证据 | 修复 |
| --- | --- | --- |
| 选中词的其他出现位置仍为绿色 | 新回归在真实 DOM 报告 `cm-selectionMatch backgroundColor rgba(153, 255, 119, 0.5)`，修复前失败 | 使用 `bg-selected-inactive` |
| 搜索当前结果仍继承第三方彩色强调 | CodeMirror 默认浅色橙色 / 深色洋红，普通搜索深色为青色 | 以更高作用域优先级覆盖；当前结果使用 `bg-selected` 加 1px `border-strong` 边线 |
| 搜索按钮带蓝灰渐变、输入不统一 | CodeMirror 运行时 CSS 使用 `linear-gradient(#eff1f5, #d9d9df)` | 使用共享背景、边框、圆角、字体和 Hover / Active / Focus Token |
| 搜索面板撑高 | 实际截图中复选框继承全局 100% 输入宽度、标签块级排列，压缩正文 | 限定搜索输入宽度、复选框尺寸、标签行内对齐；增加窄窗口高度与溢出检查 |
| 设计文档保留旧彩色时间线表述 | 旧规范仍写蓝竖线、绿勾、红叉 | 更新为中性灰边线、图标和文字状态 |

本轮不是重新做主题。生产改动仅在 `src/renderer/src/notes/notes.css`，不改笔记编辑逻辑、保存格式、模型请求、主题持久化和捕获窗口。

## 静态与运行时颜色审查

- 扫描 renderer CSS / TS / TSX / SVG / HTML 和共享 Token。
- Light、Dark 各 83 个语义颜色 Token 的 RGB 通道为中性值。
- 代码高亮继续使用灰度、粗体与斜体；截图标注颜色、用户图像、彩色应用图标源文件保持。
- 运行时检查可见元素及 `::before` / `::after` 的文字、背景、四边边框、Outline、SVG fill / stroke，同时检查渐变和灰度滤镜。
- 五个主页面及相关弹窗的截屏点均接入运行时检查，覆盖第三方动态 CSS，不只扫描手写文件。
- 常规文字 Token 在实际设计表面组合中的最低对比度：Light 4.67:1、Dark 5.23:1。代码、主要按钮、语义状态文本的既有测试满足 4.5:1；焦点与开关拇指满足 3:1。这是 Token 配对检查，不是声称整个软件已取得 WCAG 认证。

## 设计一致性检查

| 界面 / 状态 | 检查结果 |
| --- | --- |
| 截图日程 | 今天的实心数字、选择边线、事件圆点 / 菱形可区分；日期详情独立滚动，窄屏无横向溢出 |
| AI 笔记 | 文件选中、大纲、编辑 / 阅读、表格与代码均采用同套灰度；正文仍是中心；修复搜索面板与高亮 |
| 历史对话 | 列表、搜索、筛选、灰色选中、日期分组、详情和删除确认一致；数据与恢复行为通过回归 |
| AI 浮窗 | 保留最新的标题栏保存按钮；紧凑模式无缩略图操作行；展开预览保留原色、分栏与输入不溢出 |
| 设置 | 分组行、主题、模型配置、快捷键、隐私与关于的字体和留白一致；API Key 遮蔽，模型原始 ID 显示保持 |
| 导航与快捷菜单 | 展开 / 折叠、图标、选中边线、键盘焦点与命令菜单一致 |
| 弹窗 | 灰度遮罩和面板、原生焦点约束、Esc 关闭及焦点恢复通过已有测试 |
| 加载 / 空 / 错误 | 文字提示、状态符号、禁用状态保持可区分；新增模型列表加载 / 401 错误截图检查 |
| Tooltip 与原生菜单 | 应用保留原生 title 提示和可访问名称；菜单、文件选择器、窗口红黄绿由操作系统绘制，不用 CSS 强改系统像素 |

## 修改清单

- `src/renderer/src/notes/notes.css`：第三方搜索 / 匹配样式及搜索栏布局。
- `tests/helpers/neutral-chrome.ts`：共享的实际渲染颜色检查，排除图像像素。
- `tests/integration/visual-acceptance.spec.ts`：搜索 / 重复词、布局、模型加载与错误的新回归。
- `tests/integration/monochrome.spec.ts`：复用并加强原有颜色检查，保留原行为断言。
- `tests/integration/notes-preferences.spec.ts`、`workspace-browsing.spec.ts`、`quick-chat-workspace.spec.ts`：每个亮暗、多尺寸截屏点增加运行时颜色审查。
- `docs/UI_DESIGN_LANGUAGE.md`、`README.md`、本文与截图 / 性能附件：规范、交付记录。

测试使用临时存储；测试生成的已有截图也会随实际运行更新。本轮没有删除测试或增加跳过条件。

## 验证与性能

验收环境：macOS 27.0.1 arm64、Electron 44.4.1、Node 24.15.0、pnpm 11.1.3；主显示器 1728×1117 DIP，2× Retina。

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm build`（包含 `tsc --noEmit` 类型检查） | 通过 |
| `pnpm test` | 58 个文件、938 项通过 |
| `pnpm test:smoke` | 32 项通过、11 项原有条件跳过；2.4 分钟 |
| 最后搜索栏布局修正后，重新构建并运行 `notes-preferences`、`visual-acceptance`、`performance` | 3 项通过；28.7 秒 |
| 搜索颜色回归 | 修复前真实运行失败，修复后通过；未删除失败断言 |

全量冒烟覆盖主题 Light / Dark / System、跨窗口同步与重启持久化、编辑器身份和草稿保持、文件操作与退出保存、历史与日程、截图窗口复用、标注 / 复制 / 保存、AI 会话与取消、关闭不唤起主窗口以及模型配置。最后一项搜索栏高度修正另做定向回归，没有把此前的全量结果冒充修正后的重复全量执行。

11 项跳过均来自既有环境门槛，本轮未修改：真实捕获延迟 1 项、Phase 3 / 4 捕获实验各 1 项、Phase 5 原生桥接 3 项、Phase 6 耐久 / 故障 / 显示器检查 3 项、打包版 Helper 1 项、Windows 安装版 1 项。

### 性能采样

前后各 9 次（3 种尺寸各 3 轮），使用合成截图源，但实际运行 Electron 窗口、IPC、NativeImage 与文件处理。单位 ms，完整样本见 [性能采样数据](ui/ui2-stage6/performance.json)。

| 指标 | 修改前中位数 | 修改后中位数 | 修改前最大值 | 修改后最大值 |
| --- | ---: | ---: | ---: | ---: |
| 捕获开始 → 框选窗可见 | 96.95 | 101.67 | 578.35 | 110.37 |
| 框选完成 → 截图可见 | 156.04 | 139.87 | 183.60 | 191.22 |

第一项中位数增加 4.72ms；第二项减少 16.17ms，但最大值增加 7.62ms。样本有限且受调度影响，不能据此宣称整体提速或证明所有性能场景无回归。窗口复用断言通过，本轮没有修改捕获实现；真实 ScreenCaptureKit、系统快捷键派发与多显示器性能仍待专门实机验收。

## 实际 Light / Dark 截图

以下为本轮自动化启动的真实 Electron 窗口，全部使用临时合成内容，不是 HTML 设计稿。主界面截图包含 1120 与 840 DIP 宽度，保留高 DPI 原始图片。截图来源索引见 [文件清单](ui/ui2-stage6/screenshots.json)。

| 页面 / 状态 | Light | Dark |
| --- | --- | --- |
| 截图日程 | [1120](ui/ui2-stage6/schedule-light-1120.png) · [840](ui/ui2-stage6/schedule-light-840.png) | [1120](ui/ui2-stage6/schedule-dark-1120.png) · [840](ui/ui2-stage6/schedule-dark-840.png) |
| AI 笔记 | [1120](ui/ui2-stage6/notes-light-1120.png) · [840](ui/ui2-stage6/notes-light-840.png) | [1120](ui/ui2-stage6/notes-dark-1120.png) · [840](ui/ui2-stage6/notes-dark-840.png) |
| 历史对话 | [1120](ui/ui2-stage6/history-light-1120.png) · [840](ui/ui2-stage6/history-light-840.png) | [1120](ui/ui2-stage6/history-dark-1120.png) · [840](ui/ui2-stage6/history-dark-840.png) |
| 设置 | [1120](ui/ui2-stage6/settings-light-1120.png) · [840](ui/ui2-stage6/settings-light-840.png) | [1120](ui/ui2-stage6/settings-dark-1120.png) · [840](ui/ui2-stage6/settings-dark-840.png) |
| 截图 AI | [紧凑](ui/ui2-stage6/compact-light.png) · [展开](ui/ui2-stage6/expanded-light.png) | [紧凑](ui/ui2-stage6/compact-dark.png) · [展开](ui/ui2-stage6/expanded-dark.png) |
| 编辑器搜索 | [1120](ui/ui2-stage6/editor-search-light-1120.png) · [840](ui/ui2-stage6/editor-search-light-840.png) | [1120](ui/ui2-stage6/editor-search-dark-1120.png) · [840](ui/ui2-stage6/editor-search-dark-840.png) |
| 命令菜单 | [查看](ui/ui2-stage6/command-palette-light.png) | [查看](ui/ui2-stage6/command-palette-dark.png) |
| 模型弹窗 | [查看](ui/ui2-stage6/model-dialog-light.png) | [查看](ui/ui2-stage6/model-dialog-dark.png) |
| 模型加载 | [查看](ui/ui2-stage6/model-loading-light.png) | [查看](ui/ui2-stage6/model-loading-dark.png) |
| 模型错误 | [查看](ui/ui2-stage6/model-error-light.png) | [查看](ui/ui2-stage6/model-error-dark.png) |

## 剩余风险

- 真实 ScreenCaptureKit 捕获、混合 DPI / 多显示器、原生 Helper 故障与长时间压力测试依赖录屏权限和硬件，本轮没有用 Mock 结果代替。
- Windows 安装版与打包后 Helper 测试需要对应环境 / 安装包；本轮未打包发布。
- 原生 Tooltip、展开的系统 Select 弹出层及系统文件选择器的最终像素由 OS 控制；自动化验证了控件语义 / 交互与 DOM 状态，不代表每个系统主题组合都经过人工验证。
- 有限截图与测试覆盖不能证明每个业务分支、任意内容长度及所有第三方插件都已完全验收；保留静态与运行时检查防止新增颜色回归。
