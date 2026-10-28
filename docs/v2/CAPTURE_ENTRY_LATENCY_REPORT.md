# 真实快捷键入口延迟追查

日期：2026-10-24。工作目录 Snipvia-public-baseline，refactor/snipvia-v2，HEAD 3cf4498。本轮延续[输出链路优化](CAPTURE_OPTIMIZATION_REPORT.md)，针对用户反馈的“第一次可以，第二次或间歇截图从按键到框选明显变慢”。只修改客户端，不推送、打包、签名或改变用户数据和权限。

## 实际证据与判断修正

输出 Worker 已通过的测试没有覆盖原生全局快捷键入口，不能据此说用户的卡顿已解决。本轮由用户亲自按 Command+1；自动化不操作真实屏幕、系统剪贴板或全局快捷键。

加入仅数值的本地诊断后，同一开发实例记录到以下三次真实入口样本：

| 样本 | 入口 await 区间 | 原生窗口唤起调用 | 完整 SCK 请求 | 框选 shell 绘制 | 冻结图绘制 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 3292.81ms | 21.66ms | 332.17ms | 3432.26ms | 3673.06ms |
| 2 | 214.23ms | 17.86ms | 253.92ms | 486.52ms | 502.82ms |
| 3 | 3492.53ms | 12.40ms | 176.18ms | 3569.93ms | 3690.23ms |

均为 screen-capture-kit，没有 fallback。表中 shell / 冻结图绘制从快捷键回调进入计时；不是物理键盘硬件发出时间。样本少，不计算 P95、不声称超过其他软件。没有记录图片、剪贴板或用户正文。

此前将第一条的 overlayReadyWaitMs 解读成“冷启动预加载慢”不准确：第 3 条发生在同一实例已经完成前面截图之后，captureOverlayReady 是仅初始化一次的 Promise，已经完成却仍有 3.49 秒停在 await 续体前。这些数值指向原生快捷键回调与 Node/V8 异步续体之间的调度，不能将整段时间归咎于 SCK、JPEG 或屏幕尺寸。Main 忙或原生调度的具体底层机制尚未以系统 profiler 独立确认。

## 开源实现参考

只参考设计与平台处理方式，未复制第三方业务代码或添加第三方组件：

| 来源 | 实际代码观察 | 对 Snipvia 的启示 |
| --- | --- | --- |
| [eSearch main.ts](https://github.com/xushengfeng/eSearch/blob/master/src/main/main.ts) 的 getClipWin / createClipWindow / fullScreen / exitFullScreen | 可预建截图窗，进入时显式 show；退出在配置允许时 hide/reload，否则 close | 窗口复用与明确唤起有价值；不能照搬每次 reload 或其 Renderer 权限配置 |
| [Flameshot flameshot.cpp](https://github.com/flameshot-org/flameshot/blob/master/src/core/flameshot.cpp) 的 gui | macOS 为 Mission Control 处理会关闭旧 capture widget，并显式 show/activate/raise | 窗口激活、跨 Space 与截图计算需分开处理；不以“开源软件都缓存窗口”概括各项目 |
| [ksnip MacImageGrabber.cpp](https://github.com/ksnip/ksnip/blob/master/src/backend/imageGrabber/MacImageGrabber.cpp) | macOS 使用平台抓图器和 MacSnippingArea | 平台适配应独立；其 Qt 结构不直接等于 Electron 性能方案 |
| [Electron 44.4.1 native_window_mac.mm](https://github.com/electron/electron/blob/v44.4.1/shell/browser/native_window_mac.mm) 的 Show / ShowInactive / IsVisible | Show 激活应用；ShowInactive 只无焦点前置；IsVisible 同时判断 occlusion | 原生“已 orderOut”和“当前可见”不是同一状态；窗口激活不该等待整屏图片解码 |

这些源码不能证明其速度达到 PixPin，也不能证明某项底层 API 在本机必然更快。本轮没有引入持续 SCStream、后台录屏、低分辨率最终输出或新的系统授权。

## 本轮实际修改

1. **原生快捷键投递到 Node 事件循环。** dispatchCaptureHotkey 在原生回调中只记录原始到达时间并 setImmediate；Quick / Edit / Collect 在 Node 任务中进入异步截图流程。错误仍走原有错误面板；时间包含投递等待，不藏掉这段成本。
2. **热窗口不重复 await 已完成的全局就绪 Promise。** 保留冷启动等待，新增真实预加载标志及日志，区分应用启动与 Overlay 真正就绪。
3. **自排除原生路径立即唤起窗口。** 先使旧像素透明、禁止旧会话输入，再在 Main 显示/激活窗口；Renderer 确认新会话 shell 后恢复不透明度和输入。不等待 JPEG/PNG 或整屏解码才给焦点。启用 acceptFirstMouse，保持已有键盘与鼠标框选流程。
4. **独立记录原生呈现状态。** 已呈现窗口即使因 app.hide / 遮挡使 isVisible=false，结束时仍显式 orderOut 一次，避免下次重新唤起残留窗口。保留既有 app.hide 的前台退出语义。
5. **阻止 fallback 的晚到 ACK 重新显示 Overlay。** Electron 抓图期间设置 suspended 状态；shell/render ACK 不能恢复窗口，取帧完成后才允许恢复。避免自截图像素泄漏。
6. **开发诊断可关闭且有界。** 默认正式版无诊断；开发版通过环境变量或忽略目录中的开关启用，仅保留最多 30 个会话的时间、固定事件及白名单数值。异步原子写入，失败不能中断截图。没有截图、Key、Cookie、模型配置、剪贴板或自由文本元数据。

用户试用提前激活版本后仍反馈慢，这个中间版本不计为修复完成。最后一版包含 Node 调度修复；用户已完成真实连拍并明确反馈“明显改善”。记录到 5 次真实快捷键，本组未再出现此前的秒级 await 停顿；具体范围见末节。不把本机小样本扩展为全平台性能保证。

## 文件清单

| 文件 | 修改 |
| --- | --- |
| src/main/index.ts | 快捷键调度接线、预加载热路径、诊断阶段和状态 |
| src/main/windows/capture-overlay-window.ts | 提前激活、透明度/输入交接、呈现与 fallback 状态 |
| src/main/capture/dispatch-capture-hotkey.ts（新增） | 原生回调 → Node 任务的边界 |
| src/main/performance/DevCaptureLatencyLog.ts（新增） | 有界数值记录、白名单与异步写入 |
| tests/unit/capture-overlay-window.test.ts（新增） | 提前激活、遮挡后隐藏、连续复用、晚到 ACK |
| tests/unit/dispatch-capture-hotkey.test.ts（新增） | 调度边界、原始时间/模式、同步/异步失败 |
| tests/unit/capture-latency-log.test.ts（新增） | 隐私白名单、容量、阶段替换及文件输出 |
| tests/integration/capture-entry-headless.spec.ts（新增） | 真实 Main/Renderer 在取帧挂起时两次提前框选 |
| docs/DEVELOPMENT.md、UI_DESIGN_LANGUAGE.md、本报告与数值文件 | 运行诊断与验收边界 |

未改原生 Helper、图片编码器、输出队列、坐标几何层、账号/凭据、存储格式、更新通道、应用身份、录屏权限或用户快捷键设置。

## 验证与复用

- pnpm lint 通过。
- pnpm build 完整通过，包含 pnpm typecheck、Main/Worker/Preload/Renderer 及依赖声明生成。
- pnpm test：36 文件、186 测试通过；没有删除或跳过已有有效测试。
- 新隐藏入口集成通过：实际 Renderer 两次在取帧仍被挂起时生成选区，取帧返回后完成输出。窗口显示、真实快捷键、屏幕和系统剪贴板均被禁用/替换；不据此断言真实焦点速度。
- 已有隐藏输出集成复验通过：顺序提交、失败重试、原始帧释放不回归。
- Native PNG / Worker 像素与原生协议模块无变化，复用上轮通过记录和相同字节指纹，没有重复运行未变检查。
- Windows、混合 DPI、真实应用焦点、跨 Space/全屏与冷启动不新增通过结论。真实输入样本只对应本机用户主动截图。

## 本地诊断

本轮通过忽略目录中的 .dev-runtime/capture-latency.enabled 启用诊断，数值结果已归档到数值文件和本地快照。验收后已移除本轮临时开关；当前实例已初始化的日志器仍最多保留 30 个会话，正常退出重启后默认关闭，不为此自动重启应用。后续可显式启动：

~~~sh
SNIPVIA_CAPTURE_LATENCY_LOG=1 pnpm dev
~~~

不要为记录该问题启用真实屏幕留档或持续录屏。环境变量/开关只对实际开发实例生效。先确认 stage=overlay-ready，再进行手工连拍；代码重载会重置记录，试用期间不再改生产源码。

## 保全与回滚

本轮之前的源码指纹、暂存区补丁、工作区补丁及四个原文件完整副本，保存在 Git 忽略目录 .dev-runtime/capture-activation/。before-dispatch-metrics.json 保存真实用户修复前数值，不含屏幕内容。

回滚按 manifest.json 的路径逐一核对哈希：既有文件从 before-files/ 恢复；新增文件确认没有后续改动后才移除。保留前一轮输出队列/原图修复，不能整仓 reset、clean 或覆盖旧清理成果。此前大量未提交和未跟踪内容、用户暂存项保持原样。

## 最后一轮物理快捷键结果

用户于 2026-10-24（Asia/Taipei）完成当前开发实例的 Command+1 连拍，明确反馈“已完成，明显改善”。实际记录到 5 次，均已预加载、使用 SCK、无 fallback：

| 样本 | 原生回调→Node 调度 | 入口 await 区间 | shell 绘制 | 冻结图绘制 | SCK 完整请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.32 | 0.00 | 79.80 | 308.30 | 270.15 |
| 2 | 0.95 | 0.00 | 88.28 | 125.38 | 97.74 |
| 3 | 0.57 | 0.00 | 15.40 | 116.90 | 92.69 |
| 4 | 1.46 | 0.00 | 20.65 | 128.25 | 98.89 |
| 5 | 0.46 | 0.00 | 83.14 | 121.04 | 99.34 |

单位为 ms。计时从原生快捷键回调记录的到达时间开始，包含投递到 Node 的等待，不代表键盘硬件按下到屏幕的全链路测量。

- 调度等待为 0.46–2.32ms，原入口 await 区间低于 0.003ms；本组没有复现此前 214–3493ms 的停顿。
- shell 绘制为 15.40–88.28ms，完整冻结图为 116.90–308.30ms；后四次完整图约 117–128ms。shell 是可先框选的覆盖层，不能把它当作原始冻结图片已经可用。
- 3/5 的 shell ACK 时已获取原生焦点；其余两次当时仍未聚焦，因此不能把 shell 绘制时间直接标成每次键盘均已就绪。用户对当前整体交互的验收为明显改善。
- 这组证据支持当前修复有效；未单独隔离 setImmediate、跳过热路径 await 与窗口激活各自贡献，不宣称已证明上游 Electron 的内部缺陷。
- 本机当前连续节奏可记录为验收通过。更长间歇、冷启动、不同 Space/全屏、Windows 和混合 DPI 继续保持未验状态；不计算小样本 P95、不与 PixPin 作无依据的速度比较。

本次收尾只更新记录和移除临时诊断开关。业务及测试源码哈希与上一轮通过记录一致，不重复 lint、typecheck、单测、构建或隐藏集成测试。
