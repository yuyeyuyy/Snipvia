# 截图后快速切换：第二阶段开发与验收记录

## 范围与状态

日期：2026-10-28。工作目录仅为 `Snipvia-public-baseline`，分支 `refactor/snipvia-v2`，起点 `2c93e3a`。本轮继续第一阶段未提交的代码，未创建提交、推送、发布或改动其他仓库。

本阶段按用户选择优先实现 macOS Chrome 已有的 ChatGPT / DeepSeek 标签切换，以及可选的消息输入框聚焦。实现及合成集成测试已完成；真实网页聚焦尚未完成验收。开发 App 的权限声明迁移曾引发录屏授权不一致；刷新同一 App 的系统记录并从项目启动后，用户已确认可以框选并跳转。用户反馈约两秒跳转延迟后，已据真实数值优化并完成同路径复测：两次原生切换请求为 514ms、435ms，用户确认「明显更快，已经顺畅」。真实网页输入框聚焦仍未验收，不据此标记通过。

## 行为

- 旧网页目标仍使用系统默认浏览器打开保存的网址，不在加载时重写配置文件。
- 每个网页可单独选择「Chrome 已有标签」，按同一网站或完整网址匹配。只处理普通窗口，不处理隐身窗口，不以标题猜测站点。
- 唯一匹配直接切换；多个匹配显示标题与窗口/标签序号供用户选择。没有匹配、Chrome 未运行或自动化权限不足时明确提示，不悄悄打开新页面。
- 候选的原生窗口 ID、标签 ID 和完整 URL 留在 Main；浮条只收到临时 UUID、匹配标题与序号。选择与当前截图展示、目标配置和有效期绑定，防止旧候选跨会话执行。
- 切换前原生层再次检查标签 ID、窗口归属与完整 URL，按实际索引处理移动后的标签。关闭、跳转及定位失败不会伪装为成功。
- 可选聚焦只针对 `chatgpt.com` / `chat.deepseek.com`：当前 Chrome 焦点窗口中 URL 对应的唯一 WebArea，且其可见范围内存在唯一可编辑、多行文本区。遍历有时间、节点数、深度及单次消息超时限制。证据不足时不执行聚焦；按 2026-10-28 的交互修订，网页已切换成功时静默结束。
- 不读取草稿或聊天正文，不设置文本值、不选中文字、不粘贴、不发送、不改变系统剪贴板内容。截图字节不传入浏览器 helper。
- 权限仅在设置中的显式动作请求；截图、浮条展示和目标选择不会触发授权弹窗。请求失败提供状态反馈，以及固定的系统自动化/辅助功能设置入口。

## 调用与安全边界

```text
Quick 输出成功 → 原有剪贴板标记与展示会话
  → QuickTargetService
    → 本地应用：原有 QuickTargetPlatform.activate
    → 普通网页：原有 shell.openExternal
    → Chrome 已有标签：ChromeTargetService
      → QuickTargetPlatform → 独立原生 helper
        → 静态 AppleScript / Apple Events 列表与切换
        → 可选、受限的 Accessibility 输入框聚焦
```

浏览器工作不进入截图快捷键、取帧、框选或 PNG 编码的同步路径。所有子进程使用固定可执行文件和参数，没有 shell。网址与 ID 通过有界 JSON stdin、Apple Event 参数传递，不插入脚本源码。没有启用 Chrome 的「允许来自 Apple Events 的 JavaScript」、远程调试或浏览器扩展。

原生脚本为匹配而读取普通标签 URL，仅返回匹配项的标题和引用。Renderer 不收到完整 URL 或原生引用；标题可能包含用户会话名称，仅存在当前展示会话，不持久化或记录日志。隐身窗口不枚举其标签。AX 只读取角色、URL、几何与可编辑状态，不读取 `AXValue` 内容。

Main/Preload 保留按窗口角色和主 frame 验证的 IPC。设置修改及权限请求限设置窗口；激活与候选选择限当前浮条。新截图、关闭、剪贴板变化、设置变化和退出会取消当前工作并清理候选。已经送达操作系统的操作不能承诺撤回，失败后不主动恢复其他窗口或用户剪贴板。

## 文件级改动

以下为第二阶段相对本轮开始快照的范围，第一阶段原有功能仍保留。

| 文件 | 改动 |
| --- | --- |
| `src/shared/quick-target.ts` | 可选浏览器配置、候选/结果类型、权限和严格 IPC schema；旧配置兼容 |
| `src/main/storage/QuickTargetPreferencesStore.ts` | 按已注册网页 ID 修改浏览器选项；原子保存及损坏文件保护沿用 |
| `src/main/quick-target/ChromeTargetService.ts`、`ChromeWorker.ts` | URL 匹配、临时候选引用、合并调用、预热管道、取消/超时/旧进程隔离及降级结果 |
| `src/main/quick-target/QuickTargetPlatform.ts` | 有界子进程 stdin、浏览器/权限桥；错误不带原始脚本输出 |
| `src/main/quick-target/QuickTargetRegistry.ts` | 向设置暴露浏览器选项与明确的目标说明 |
| `src/main/quick-target/QuickTargetService.ts` | 当前展示内选择标签、可选聚焦静默降级及失效清理 |
| `native/quick-target-helper/Browser.swift`、`main.swift`、`Info.plist` | 静态脚本、无弹窗权限查询、显式授权、受限 AX；helper 用途声明 |
| `src/main/index.ts`、`src/preload/index.ts` | 接入新桥与窄 IPC；权限请求串行，系统设置 URL 固定 |
| `src/main/windows/QuickTargetWindow.ts` | 候选列表尺寸与小屏边界限制 |
| `src/renderer/src/quick-target/*` | 紧凑候选列表、状态提示、上下左右及 Tab 键盘访问 |
| `src/renderer/src/settings/QuickTargetSettings.tsx` 及 CSS | 每网页模式/匹配/聚焦设置与权限入口；点击时重新检查 Chrome |
| `src/renderer/src/permissions/ScreenPermissionCard.tsx`、`src/main/platform/index.ts` | 更正开发签名变化和系统重启裸 Electron 的引导 |
| `scripts/build-quick-target-helper.sh`、`scripts/prepare-release-build.mjs` | 新原生源码/用途声明的双架构编译及缓存输入 |
| `electron-builder.yml`、`build/entitlements.release.quick-target.plist`、`scripts/macos-release/{common,hooks}.cjs` | 正式包用途声明、helper 的独立最小 AE entitlement 和稳定 ID；本轮未执行正式签名 |
| `scripts/dev-stable-app.sh` | 新开发包含用途声明；旧包迁移需显式 opt-in，完整备份并验证后才本地临时签名 |
| `tests/unit/quick-target-{chrome,preferences,service,window,worker}.test.ts` | 匹配、候选伪造/过期、取消、权限缺失、旧数据及小屏边界 |
| `tests/integration/quick-target-headless.spec.ts` | 保留原有全部场景并增加 Chrome 多标签、未授权反馈、降级和跨窗口拒绝 |
| `scripts/test-quick-target-helper.mjs`、`scripts/test-quick-target-worker.mjs` | 静态 AppleScript 语法、自定义小消息管道回归；保留合成原生应用激活验证 |

截图原生引擎、框选/标注、收纳数据结构、更新模块、现有模型/历史数据及锁文件没有为此阶段改动。没有引入依赖。

## 验证记录

| 检查 | 实际结果与边界 |
| --- | --- |
| `pnpm lint` | 最终通过，包括权限帮助文案与 worker |
| `pnpm typecheck` / `pnpm build` | 构建内类型检查与正式构建通过；只有原有 Zod 注释告警，122 个生产依赖版本 |
| `pnpm test` | 47 个文件、261 项通过 |
| `quick-target-headless.spec.ts` | 最终 1 项通过：保留原有 10 次 Quick、失败重试、旧会话、剪贴板、角色隔离场景，并覆盖新设置、多个标签选择、候选伪造、权限提示、关闭/跳转和手动聚焦结果。浏览器桥为合成 fixture，不能代替实际 Chrome 验收 |
| `quick-target-focus.spec.ts` | 真实两个 Electron 应用验证鼠标/键盘浮条焦点，1 项通过 |
| `capture-focus-return.spec.ts` | 真实 Electron 截图退出焦点返回，1 项通过 |
| 原生 helper | arm64 / x86_64 编译通过；静态 AppleScript 编译通过。合成 AppKit 应用激活通过，记录约 108ms；不是整体截图 p95 |
| 实际开发 App 的 Chrome 权限 | 首次点击未响应；TCC 日志确认缺少用途声明。补齐并重启后，实际设置页显示 Chrome 已授权 |
| 录屏权限迁移回归 | 更新开发签名后出现系统开关开启、App 未授权；用户明确允许刷新同一 App 记录，已通过系统界面处理。刷新后用户已明确确认正常框选和网页跳转 |
| 实际 ChatGPT 跳转性能 | 同一路径优化后两次原生请求为 514ms、435ms，平均约 475ms；用户确认明显更快、已经顺畅。仅为两次真实样本，不代表完整截图链路或 p95 |
| 实际 ChatGPT / DeepSeek 聚焦 | 尚未完成成功验收；2026-10-28 已按用户确认刷新旧签名的辅助功能记录，应用内确认已授权。用户随后反馈未命中唯一输入框，本轮仅调整该结果的提示行为 |

合成 Light / Dark 候选界面见 `docs/ui/v2/quick-target-chrome-light.png` 与 `quick-target-chrome-dark.png`，没有用户聊天数据。截图使用关闭动画的稳定状态。自动测试中初次失败包括异步复选框保存的即时断言、测试字符串类型/引号、两个合法 alert 的选择器歧义，均已修正；未删除或跳过既有有效测试。

## 开发 App 迁移与故障恢复

系统实际把子进程的 Apple Events 请求归属于负责启动它的 `截然 Dev.app`；只给 helper 写用途声明不足。现有开发 App 原来缺少 `NSAppleEventsUsageDescription`，日志明确显示系统直接拒绝请求。

本轮先完整复制并验证旧开发 App，再增加一项用途声明并进行本地 ad-hoc 签名；核对 Info.plist 只有该键变化，Bundle ID、Electron 版本、录屏说明均保留。但是 ad-hoc 指定要求的 CDHash 仍会变化，不能据此承诺旧 TCC 授权持续有效。实际录屏故障已经说明此风险。本轮没有使用 Developer ID、执行公证或发布。

为避免普通启动再次触发这种迁移，旧开发包升级改为显式 `SNIPVIA_DEV_AUTOMATION_UPGRADE=1 pnpm dev`，只在缺键且停止运行时执行；日常 `pnpm dev` 不因此修改已存在的开发包。新建开发包在第一次签名之前就包含声明。

macOS 的「退出并重新打开」可能启动不带项目参数的 Electron 欢迎页。开发模式应在权限对话框选「以后」，然后从项目目录重启 `pnpm dev`；不要通过 Finder 单独打开这个开发壳。启动器没有改成后台监视或擅自修改系统 TCC 数据库。正式包内置客户端入口，不依赖这个开发参数。

恢复材料均在已忽略的本机 `.dev-runtime` 下：

- 源码快照：`quick-target-phase2/before-20261028-143100`，36 项原有修改/未跟踪文件、SHA-256 清单、tracked/staged patch、起始 HEAD，创建时逐项校验。
- 开发 App 快照：`dev-permissions/20261028-145825-42929/截然 Dev.app`，完整 App 与原签名；复制后 `codesign --verify --deep --strict` 通过。

回退源码应先保存本轮修改，再按清单恢复对应文件；不要 `reset --hard` 或 `clean`。回退开发壳应退出同一路径的实例后从完整 App 快照覆盖恢复并校验签名，正常 `pnpm dev` 不再自动升级；系统权限记录不会随文件备份自动回滚，必要时由用户重新添加同一路径的 App。用户数据目录、截图、密文及偏好不属于这些恢复操作，不删除。

## 剩余验收与下一阶段条件

1. 用户已确认当前开发实例能正常框选和跳转，并完成同一 ChatGPT 目标的两次性能复测，反馈明显更快、已经顺畅。该路径本轮体验验收通过；连续截图、其他目标和整体 p95 不由这两次样本推定。
2. 在已授权 Chrome 的实际实例验证：唯一/多个 ChatGPT 和 DeepSeek 标签；不同窗口；标签移动、关闭和跳转；隐身排除；最小化恢复。窗口序号不代表 Chrome Profile 名称。
3. 用户显式授予辅助功能后验证真实网页 AX：唯一消息编辑区可聚焦、已有草稿保持、多个编辑区/只读/不可见区退回手动；不代粘贴、发送或读取草稿。
4. macOS 全屏 Space、多屏和混合 DPI、Windows/Safari、本地聊天软件输入框均不冒充通过。Windows 继续保留普通网页打开路径，没有新增原生切换适配。
5. 当前代码无需等待未来商业化或浏览器扩展架构。若真实网页无法提供可靠 AX 语义，再以实际证据决定是否需要独立浏览器适配，不能为覆盖率开启远程脚本执行或坐标盲点。


## 跳转延迟的实际诊断与优化

用户反馈跳转不够快后，在真实开发实例启用只含固定步骤名、毫秒数值与成功布尔值的诊断；不记录网址、标题、截图、剪贴板内容或凭据。日志仅在本机已忽略的 `.dev-runtime` 中。优化前用户完成的两次请求为：

| 原生步骤 | 第一次 | 第二次 |
| --- | ---: | ---: |
| 权限子进程 | 138ms | 160ms |
| 标签查询子进程 | 1148ms | 993ms |
| 标签切换子进程 | 986ms | 853ms |
| 原生调用累计 | 2272ms | 2006ms |

这是两次真实样本的原生调用累计，不是完整截图耗时或 p95。原始数值保存在本机 `quick-target-phase2/before-timing.json`，不包含用户内容。

已移除热路径上的重复进程启动：唯一匹配在一个原生请求内完成权限核实、查找和切换；按窗口批量读取 URL/ID，不再对每个标签逐个跨进程查询。编译后的固定 AppleScript 由单个按需预热 helper 复用。只有功能开启且配置 Chrome 已有标签时预热，关闭功能、移除相关配置或退出时释放。主进程崩溃后管道 EOF 使 helper 退出。新截图不等待这个浏览器进程；浏览器选择取消/超时会杀死对应旧进程，旧回复不能完成新请求。

真实原生管道回归验证预热约 955–1002ms，之后三次缺参请求往返 0–1ms；这些缺参请求没有读取/激活浏览器，不能当成网页跳转性能。测试还发现 Foundation 的读缓冲会等待填满，已改用每次最多 1024 字节的 POSIX 读取，保证小消息即时处理；每帧上限 8192 字节、返回缓存上限 256KiB、请求上限 4 秒，按当前请求 UUID 关联。只允许 resolve/select 两个操作，不接受脚本或任意文件路径。每次原生请求使用 autoreleasepool 释放临时对象。

优化后已通过构建、Lint、261 项单测、真实原生管道测试，以及三个相关 Electron 集成测试（最终 3 passed / 19.1s）。用户随后在预热完成的同一开发实例中，按原操作完成两次「Command+1 截图 → 点击同一个 ChatGPT 目标」，明确反馈「明显更快，已经顺畅」。

| 同路径原生调用 | 第一次 | 第二次 | 平均 |
| --- | ---: | ---: | ---: |
| 优化前，权限/查找/切换累计 | 2272ms | 2006ms | 2139ms |
| 优化后，合并查找与切换请求 | 514ms | 435ms | 474.5ms |

两次样本的平均原生调用耗时减少约 78%。优化后设置/启动阶段另有 1353ms、1434ms 的权限探测，不属于这两次跳转请求，未纳入对比。数值备份位于本机 `quick-target-phase2/after-timing.json`，仅保存固定步骤名、耗时及成功状态。这里比较的是原生桥调用耗时，不包含完整的快捷键到框选、屏幕呈现或输入框就绪时间，也不是 p95；ChatGPT / DeepSeek 真实输入框聚焦仍须单独验收。

本次仅补录实际数值和用户反馈，保留当前运行实例；没有重复运行已通过的代码检查、重载应用、提交或推送。

## 图标显示修复（2026-10-28）

用户反馈快速切换条和设置中图标均未正常显示。实际独立 Electron 读取已配置的四个应用，均返回同一个 1181 字节的浅色通用图标；原网页目标没有品牌图标，始终显示通用 globe。不是通过放大 CSS 掩盖数据问题。

本次改为复用独立 helper 的 AppKit 图标命令，验证应用包后固定栅格化为 68×68 PNG，输出大小与桥接结果有上限。设置和浮条共用 `QuickTargetIcon`；图片失败显示回退图标，读取失败不永久缓存，成功读取在内存复用，不进入截图或点击跳转路径。网页仅按精确域名选择内置 OpenAI / DeepSeek 矢量，其他网页保留通用图标；不会按可编辑名称猜品牌或联网请求 favicon。第三方来源、固定提交及完整 MIT 条款已补入 `THIRD_PARTY_NOTICES.md`，未引入依赖。

文件：`native/quick-target-helper/main.swift`、`QuickTargetPlatform.ts`、`QuickTargetRegistry.ts`、Main 接线、共享 `QuickTargetView` 可选字段、两处界面、共用图标组件/矢量/CSS，以及新增 registry 单测和原有 headless 集成测试的增量场景。旧偏好格式及 URL、应用激活和截图流程保持兼容。

验证结果：Lint、类型检查、构建通过；48 个单测文件 / 264 项通过；扩展后的 headless 集成测试通过，覆盖两处图标、深浅主题及损坏图片回退。arm64 / x86_64 原生编译通过，四个实际应用分别读到不同的 68×68 PNG（7903、6243、5677、5882 字节），非应用路径被拒绝。浏览器 worker 小消息协议回归通过，未查询或激活浏览器，未重复要求用户验收已确认的跳转速度。合成图标截图为本机 `quick-target-phase2/icons-light.png` / `icons-dark.png`，不包含截图内容或会话信息。

本轮源码与旧 helper 备份位于 `.dev-runtime/quick-target-icons/before-20261028-202346`。未修改开发 App 的 Info.plist、签名或系统授权；未提交、推送或发布。

## 网站图标与浏览器角标增量（2026-10-28）

网页图标已改为公开首页声明解析、后台下载及有界本地缓存，保留上一轮内置图标回退；设置与浮条左下角显示打开目标所用的浏览器图标。现有截图后切换速度验收不重复进行。源代码、网络边界、缓存、真实联网结果与未覆盖格式见[本轮记录](WEBSITE_ICON_REPORT.md)。

## 可选聚焦失败的静默结束（2026-10-28）

按用户反馈，移除「已切换网页；未找到唯一可编辑输入框，请手动点击后粘贴」这类提示。ChromeTargetService 仍如实区分网页已激活但可选聚焦未完成的结果；QuickTargetService 收到该结果后直接收起，不把聚焦记录成成功。多个标签继续提供选择，真正的网页切换错误仍使用既有错误反馈。辅助功能权限、候选验证、截图与剪贴板保持原有边界。

修改只涉及 QuickTargetService 的完成分支，以及对应单测、原 headless 集成测试和说明。本轮在 .dev-runtime/quick-target-silent-focus 下保留修改前文件，不重签开发 App、不改变系统授权，不重复要求用户验收跳转速度。

本次静默结束验证：Lint、类型检查和构建通过；50 个单测文件 / 276 项通过；原 headless 集成测试保留全部场景并新增静默收起及剪贴板标记断言后通过（5.3 秒）。同一测试继续验证 Chrome 切换错误仍有反馈、多标签选择保持可用；没有通过删除或跳过用例取消提示。
